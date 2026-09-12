// @vitest-environment node

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST as streamAgent } from "@/app/api/mastra/[...mastra]/route";
import { mastra } from "@/mastra";
import { DELETE, GET } from "./route";

const signedInUserId = "user-1";
let sessionUserId: string | undefined = signedInUserId;

vi.mock("@/features/user/user-auth", () => ({
  auth: {
    api: {
      getSession: () =>
        Promise.resolve(sessionUserId ? { user: { id: sessionUserId } } : null),
    },
  },
}));

beforeEach(() => {
  vi.stubEnv("OPENCODE_API_KEY", "test-key");
});

afterEach(() => {
  sessionUserId = signedInUserId;
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

/** Starts a turn the way the chat does, and answers the reply the test controls. */
async function startTurn(threadId: string) {
  const reply = heldProviderReply();
  const started = Promise.withResolvers<Request>();
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>((input, init) => {
      started.resolve(new Request(input, init));
      return Promise.resolve(reply.response);
    })
  );
  const browser = new AbortController();
  const response = await streamAgent(
    new Request("http://localhost:3002/api/mastra/agents/agent/stream", {
      body: JSON.stringify({
        memory: { resource: signedInUserId, thread: threadId },
        messages: [
          {
            id: "user-1",
            parts: [{ text: "Hello", type: "text" }],
            role: "user",
          },
        ],
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: browser.signal,
    })
  );
  return { browser, providerRequest: started.promise, reply, response };
}

function resumeRequest(threadId: string, method = "GET") {
  return [
    new Request(`http://localhost:3002/api/chat/${threadId}/stream`, {
      method,
    }),
    { params: Promise.resolve({ threadId }) },
  ] as const;
}

/** The text the agent streamed, read from Mastra's native chunks. */
async function streamedText(response: Response) {
  const body = await response.text();
  const text: string[] = [];
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) {
      continue;
    }
    const chunk = JSON.parse(line.slice("data: ".length));
    if (chunk.type === "text-delta") {
      text.push(chunk.payload.text);
    }
  }
  return text.join("");
}

it("replays the reply still being written to a chat that reconnects", async () => {
  const threadId = crypto.randomUUID();
  const { browser, providerRequest, reply, response } =
    await startTurn(threadId);
  const provider = await providerRequest;
  reply.write("Half ");
  // The browser goes away mid-reply; only its copy of the stream ends.
  browser.abort();
  await response.body?.cancel().catch(() => undefined);

  const resumed = await GET(...resumeRequest(threadId));
  reply.write("a reply.");
  reply.finish();

  expect(resumed.status).toBe(200);
  expect(await streamedText(resumed)).toBe("Half a reply.");
  expect(provider.signal.aborted).toBe(false);
});

it("answers a thread with nothing in flight with no content", async () => {
  const response = await GET(...resumeRequest(crypto.randomUUID()));

  expect(response.status).toBe(204);
});

it("refuses a thread stored under another account", async () => {
  const threadId = crypto.randomUUID();
  const memory = await mastra.getAgentById("agent").getMemory();
  await memory?.createThread({ resourceId: "user-2", threadId });

  const resumed = await GET(...resumeRequest(threadId));
  const stopped = await DELETE(...resumeRequest(threadId, "DELETE"));

  expect(resumed.status).toBe(403);
  expect(stopped.status).toBe(403);
});

it("stops the run on the server, not only in the browser", async () => {
  const threadId = crypto.randomUUID();
  const { providerRequest, reply, response } = await startTurn(threadId);
  const provider = await providerRequest;
  reply.write("Half ");

  const stopped = await DELETE(...resumeRequest(threadId, "DELETE"));
  await response.text();

  expect(stopped.status).toBe(204);
  expect(provider.signal.aborted).toBe(true);
  expect((await GET(...resumeRequest(threadId))).status).toBe(204);
});
