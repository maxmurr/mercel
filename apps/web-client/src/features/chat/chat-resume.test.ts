// @vitest-environment node

import { Chat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET as messagesRoute } from "@/app/api/chat/[threadId]/messages/route";
import { GET as resumeStreamRoute } from "@/app/api/chat/[threadId]/stream/route";
import { POST as streamAgent } from "@/app/api/mastra/[...mastra]/route";
import { createChatTransport } from "@/features/chat/chat-transport";
import { mastra } from "@/mastra";

const signedInUserId = "user-1";

vi.mock("@/features/user/user-auth", () => ({
  auth: {
    api: {
      getSession: () => Promise.resolve({ user: { id: signedInUserId } }),
    },
  },
}));

beforeEach(() => {
  vi.stubEnv("OPENCODE_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** A provider reply the test finishes by hand, so a turn can be left in flight. */
function heldProviderReply() {
  let chunks: ReadableStreamDefaultController<string>;
  const body = new ReadableStream<string>({
    start(controller) {
      chunks = controller;
    },
  }).pipeThrough(new TextEncoderStream());
  const send = (delta: Record<string, unknown>, finishReason: string | null) =>
    chunks.enqueue(
      `data: ${JSON.stringify({
        choices: [{ delta, finish_reason: finishReason, index: 0 }],
        created: 0,
        id: "completion",
        model: "glm-5.3-flash",
        object: "chat.completion.chunk",
      })}\n\n`
    );
  return {
    finish() {
      send({}, "stop");
      chunks.enqueue("data: [DONE]\n\n");
      chunks.close();
    },
    response: new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    }),
    write(content: string) {
      send({ content, role: "assistant" }, null);
    },
  };
}

/**
 * Routes the browser's own requests to the app's handlers and everything else
 * to the held provider reply, so one turn can be started and then resumed.
 */
function stubBrowserFetch(threadId: string, reply: Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>((input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith(`/api/chat/${threadId}/stream`)) {
        return resumeStreamRoute(
          new Request(`http://localhost:3002${url}`, init),
          { params: Promise.resolve({ threadId }) }
        );
      }
      return Promise.resolve(reply);
    })
  );
}

/** A distinct ID per turn: a message ID is a memory key, so tests must not share one. */
function userMessage(): UIMessage {
  return {
    id: crypto.randomUUID(),
    parts: [{ text: "Hello", type: "text" }],
    role: "user",
  };
}

it("streams the running reply into the chat that reconnects", async () => {
  const threadId = crypto.randomUUID();
  const prompt = userMessage();
  const reply = heldProviderReply();
  stubBrowserFetch(threadId, reply.response);

  const started = await streamAgent(
    new Request("http://localhost:3002/api/mastra/agents/agent/stream", {
      body: JSON.stringify({
        memory: { resource: signedInUserId, thread: threadId },
        messages: [prompt],
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );
  reply.write("Half ");
  // The tab that started the turn goes away; the run keeps writing.
  await started.body?.cancel().catch(() => undefined);

  const chat = new Chat({
    id: threadId,
    messages: [prompt],
    transport: createChatTransport(signedInUserId),
  });
  const resumed = chat.resumeStream();
  reply.write("a reply.");
  reply.finish();
  await resumed;

  const assistant = chat.messages.at(-1);
  expect(chat.status).toBe("ready");
  expect(assistant?.role).toBe("assistant");
  expect(
    assistant?.parts.map((part) => (part.type === "text" ? part.text : ""))
  ).toContain("Half a reply.");
});

it("keeps the prompt visible to a chat that reloads mid-reply", async () => {
  const threadId = crypto.randomUUID();
  const prompt = userMessage();
  const reply = heldProviderReply();
  stubBrowserFetch(threadId, reply.response);

  const started = await streamAgent(
    new Request("http://localhost:3002/api/mastra/agents/agent/stream", {
      body: JSON.stringify({
        memory: { resource: signedInUserId, thread: threadId },
        messages: [prompt],
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );
  reply.write("Half ");
  await started.body?.cancel().catch(() => undefined);

  const reloaded = await (
    await messagesRoute(
      new Request(`http://localhost:3002/api/chat/${threadId}/messages`),
      { params: Promise.resolve({ threadId }) }
    )
  ).json();

  reply.finish();
  expect(reloaded).toMatchObject({
    isStreaming: true,
    messages: [{ parts: [{ text: "Hello", type: "text" }], role: "user" }],
  });
});

it("leaves one copy of the prompt once the reply lands", async () => {
  const threadId = crypto.randomUUID();
  const prompt = userMessage();
  const reply = heldProviderReply();
  stubBrowserFetch(threadId, reply.response);

  const started = await streamAgent(
    new Request("http://localhost:3002/api/mastra/agents/agent/stream", {
      body: JSON.stringify({
        memory: { resource: signedInUserId, thread: threadId },
        messages: [prompt],
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );
  reply.write("A reply.");
  reply.finish();
  await started.text();

  const stored = await (
    await messagesRoute(
      new Request(`http://localhost:3002/api/chat/${threadId}/messages`),
      { params: Promise.resolve({ threadId }) }
    )
  ).json();

  expect(
    stored.messages.filter((message: UIMessage) => message.role === "user")
  ).toHaveLength(1);
});

it("sends the model one copy of a prompt it already stored", async () => {
  const threadId = crypto.randomUUID();
  const prompt = userMessage();
  const reply = heldProviderReply();
  const providerRequests: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>((input, init) => {
      providerRequests.push(new Request(String(input), init));
      return Promise.resolve(reply.response);
    })
  );

  const started = await streamAgent(
    new Request("http://localhost:3002/api/mastra/agents/agent/stream", {
      body: JSON.stringify({
        memory: { resource: signedInUserId, thread: threadId },
        messages: [prompt],
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );
  reply.write("A reply.");
  reply.finish();
  await started.text();

  const providerRequest = providerRequests.at(0);
  if (!providerRequest) {
    throw new Error("Provider request missing");
  }
  const modelPrompt = await providerRequest.json();
  expect(
    modelPrompt.messages.filter(
      (message: { role: string }) => message.role === "user"
    )
  ).toHaveLength(1);
});

it("does not send a chat after a run suspended on a tool approval", async () => {
  const threadId = crypto.randomUUID();
  const agent = mastra.getAgentById("agent");
  const suspended = { runId: "run-1" };
  vi.spyOn(agent, "getActiveThreadRunId").mockReturnValue(suspended.runId);
  vi.spyOn(agent, "listSuspendedRuns").mockResolvedValue({
    runs: [suspended],
  } as Awaited<ReturnType<typeof agent.listSuspendedRuns>>);

  const reloaded = await (
    await messagesRoute(
      new Request(`http://localhost:3002/api/chat/${threadId}/messages`),
      { params: Promise.resolve({ threadId }) }
    )
  ).json();

  expect(reloaded.isStreaming).toBe(false);
});
