// @vitest-environment node

import { readUIMessageStream, type UIMessage } from "ai";
import { afterEach, expect, it, vi } from "vitest";
import { MastraChatTransport } from "@/lib/mastra-chat-transport";
import { mastra } from "@/mastra";
import { designBrief } from "@/mastra/processors/design-brief";
import { GET, POST } from "./route";

const signedInUserId = "user-1";
let sessionUserId: string | undefined = signedInUserId;

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: () =>
        Promise.resolve(sessionUserId ? { user: { id: sessionUserId } } : null),
    },
  },
}));

function streamRequest(body: Record<string, unknown>) {
  return new Request("http://localhost:3002/api/mastra/agents/agent/stream", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

const userMessages = [
  { id: "user-1", parts: [{ text: "Hello", type: "text" }], role: "user" },
];

afterEach(() => {
  sessionUserId = signedInUserId;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("refuses the native API without a session", async () => {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  sessionUserId = undefined;

  const streamed = await POST(streamRequest({ messages: userMessages }));
  const listed = await GET(
    new Request("http://localhost:3002/api/mastra/agents")
  );

  expect(streamed.status).toBe(401);
  expect(listed.status).toBe(401);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("refuses a thread stored under another account", async () => {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  const memory = await mastra.getAgentById("agent").getMemory();
  const otherAccountThread = await memory?.createThread({
    resourceId: "user-2",
    threadId: crypto.randomUUID(),
  });
  if (!otherAccountThread) {
    throw new Error("Thread fixture missing");
  }

  const response = await POST(
    streamRequest({
      memory: { resource: "user-2", thread: otherAccountThread.id },
      messages: userMessages,
    })
  );

  expect(response.status).toBe(403);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("stores the conversation under the signed-in account, not the one requested", async () => {
  vi.stubEnv("OPENCODE_API_KEY", "test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(() => Promise.resolve(providerStream()))
  );
  const threadId = crypto.randomUUID();

  const response = await POST(
    streamRequest({
      memory: { resource: "user-2", thread: threadId },
      messages: userMessages,
    })
  );
  await response.text();

  const memory = await mastra.getAgentById("agent").getMemory();
  const thread = await memory?.getThreadById({ threadId });
  expect(thread?.resourceId).toBe(signedInUserId);
});

function providerStream(textChunks = ["Hello!"]) {
  const chunks = [
    ...textChunks.map((content) => ({
      choices: [
        {
          delta: { content, role: "assistant" },
          finish_reason: null,
          index: 0,
        },
      ],
    })),
    { choices: [{ delta: {}, finish_reason: "stop", index: 0 }] },
  ];
  return new Response(
    `${chunks.map((chunk) => `data: ${JSON.stringify({ ...chunk, created: 0, id: "completion", model: "deepseek-flash", object: "chat.completion.chunk" })}\n\n`).join("")}data: [DONE]\n\n`,
    {
      headers: { "Content-Type": "text/event-stream" },
    }
  );
}

async function readChatReply(
  transport: MastraChatTransport,
  messages: UIMessage[],
  sessionId: string
) {
  const stream = await transport.sendMessages({
    abortSignal: undefined,
    body: { requestContext: { opencodeSessionId: sessionId } },
    chatId: sessionId,
    messageId: undefined,
    messages,
    trigger: "submit-message",
  });
  let reply: UIMessage | undefined;
  for await (const message of readUIMessageStream({
    message: { id: crypto.randomUUID(), parts: [], role: "assistant" },
    stream,
  })) {
    reply = message;
  }
  if (!reply) {
    throw new Error("Chat reply missing");
  }
  return reply;
}

it("lists the registered agent through the native API prefix", async () => {
  const response = await GET(
    new Request("http://localhost:3002/api/mastra/agents")
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ agent: { name: "Agent" } });
});

it("does not serve Mastra routes outside the configured prefix", async () => {
  const response = await GET(new Request("http://localhost:3002/api/agents"));

  expect(response.status).toBe(404);
});

it("converts the native agent stream into AI SDK messages with full history and stable sessions", async () => {
  vi.stubEnv("OPENCODE_API_KEY", "test-key");
  const fetchMock = vi.fn<typeof fetch>(() =>
    Promise.resolve(providerStream())
  );
  vi.stubGlobal("fetch", fetchMock);
  const sessionId = crypto.randomUUID();
  const transport = new MastraChatTransport({
    api: "http://localhost:3002/api/mastra/agents/agent/stream",
    fetch: async (input, init) => await POST(new Request(input, init)),
  });
  const messages: UIMessage[] = [
    { id: "user-1", parts: [{ text: "Hello", type: "text" }], role: "user" },
  ];

  const firstReply = await readChatReply(transport, messages, sessionId);
  messages.push(firstReply, {
    id: "user-2",
    parts: [{ text: "Follow up", type: "text" }],
    role: "user",
  });
  const secondReply = await readChatReply(transport, messages, sessionId);
  for (const reply of [firstReply, secondReply]) {
    expect(reply).toMatchObject({
      parts: expect.arrayContaining([
        expect.objectContaining({ text: "Hello!", type: "text" }),
      ]),
      role: "assistant",
    });
  }

  expect(fetchMock).toHaveBeenCalledTimes(2);
  for (const call of fetchMock.mock.calls) {
    const request = new Request(...call);
    expect(request.url).toBe("https://opencode.ai/zen/go/v1/chat/completions");
    expect(request.headers.get("x-opencode-session")).toBe(sessionId);
    expect(request.headers.get("authorization")).toBe("Bearer test-key");
  }
  const secondCall = fetchMock.mock.calls.at(1);
  if (!secondCall) {
    throw new Error("Follow-up provider request missing");
  }
  expect((await new Request(...secondCall).json()).messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ content: `${designBrief}Hello`, role: "user" }),
      expect.objectContaining({ content: "Hello!", role: "assistant" }),
      expect.objectContaining({ content: "Follow up", role: "user" }),
    ])
  );
});

it.each([
  { chunks: ["One two three."], expected: ["One ", "two ", "three."] },
  { chunks: ["Next re", "ply."], expected: ["Next ", "reply."] },
])(
  "paces provider chunks $chunks into words without losing text",
  async ({ chunks, expected }) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.stubEnv("OPENCODE_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() => Promise.resolve(providerStream(chunks)))
    );
    const transport = new MastraChatTransport({
      api: "http://localhost:3002/api/mastra/agents/agent/stream",
      fetch: async (input, init) => await POST(new Request(input, init)),
    });
    const startedAt = Date.now();
    const stream = await transport.sendMessages({
      abortSignal: undefined,
      chatId: crypto.randomUUID(),
      messageId: undefined,
      messages: [
        {
          id: "user-1",
          parts: [{ text: "Hello", type: "text" }],
          role: "user",
        },
      ],
      trigger: "submit-message",
    });
    const deltas: { text: string; time: number }[] = [];
    const consumed = (async () => {
      for await (const chunk of stream) {
        if (chunk.type === "text-delta") {
          deltas.push({ text: chunk.delta, time: Date.now() - startedAt });
        }
      }
    })();

    await vi.runAllTimersAsync();
    await consumed;

    expect(deltas).toEqual(
      expected.map((text, index) => ({ text, time: index * 20 }))
    );
    expect(deltas.map(({ text }) => text).join("")).toBe(chunks.join(""));
  }
);

it("keeps generating after the browser drops the connection", async () => {
  vi.stubEnv("OPENCODE_API_KEY", "test-key");
  const started = Promise.withResolvers<Request>();
  const fetchMock = vi.fn<typeof fetch>((input, init) => {
    started.resolve(new Request(input, init));
    return Promise.resolve(providerStream());
  });
  vi.stubGlobal("fetch", fetchMock);
  const controller = new AbortController();
  const response = await POST(
    new Request("http://localhost:3002/api/mastra/agents/agent/stream", {
      body: JSON.stringify({
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
      signal: controller.signal,
    })
  );
  const responseText = response.text();
  const providerRequest = await started.promise;
  controller.abort();
  await responseText;
  // The reply outlives the request so a reload can resume it; ending it early
  // goes through DELETE /api/chat/[threadId]/stream instead.
  expect(providerRequest.signal.aborted).toBe(false);
});

it("rejects missing messages without calling the provider", async () => {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  const response = await POST(
    new Request("http://localhost:3002/api/mastra/agents/agent/generate", {
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );

  expect(response.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});
