// @vitest-environment node

import type { RequestContext } from "@mastra/core/request-context";
import { readUIMessageStream, type UIMessage } from "ai";
import { afterEach, expect, it, vi } from "vitest";
import { MastraChatTransport } from "@/features/chat/chat-transport";
import { mastra } from "@/mastra";
import { designBrief } from "@/mastra/processors/design-brief";
import { DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT } from "./route";

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

function streamRequest(body: Record<string, unknown>, search = "") {
  return new Request(
    `http://localhost:3002/api/mastra/agents/agent/stream${search}`,
    {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }
  );
}

const userMessages = [
  {
    id: crypto.randomUUID(),
    parts: [{ text: "Hello", type: "text" }],
    role: "user",
  },
];

afterEach(() => {
  sessionUserId = signedInUserId;
  vi.restoreAllMocks();
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

it("denies native reads of another account's conversation", async () => {
  const memory = await mastra.getAgentById("agent").getMemory();
  const thread = await memory?.createThread({
    resourceId: "user-2",
    threadId: crypto.randomUUID(),
    title: "Private conversation",
  });
  if (!thread) {
    throw new Error("Thread fixture missing");
  }
  const response = await GET(
    new Request(
      `http://localhost:3002/api/mastra/memory/threads/${thread.id}?agentId=agent&resourceId=user-2`
    )
  );

  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain("Private conversation");
});

it.each([
  ["GET", GET, "/memory/threads?agentId=agent&resourceId=user-2"],
  ["GET", GET, "/memory/threads/foreign/messages?agentId=agent"],
  ["DELETE", DELETE, "/memory/threads/foreign?agentId=agent"],
  ["POST", POST, "/memory/threads"],
  ["POST", POST, "/agents/agent/generate"],
  ["POST", POST, "/agents/agent/stream-legacy"],
  ["POST", POST, "/agents/other/stream"],
  ["POST", POST, "/agents/agent/tools/ask_user/execute"],
  ["GET", GET, "/agents/agent/suspended-runs"],
  ["POST", POST, "/workflows/agentic-loop/resume"],
  ["GET", GET, "/workspace/files"],
  ["PUT", PUT, "/agents/agent/stream"],
  ["PATCH", PATCH, "/agents/agent/stream"],
  ["HEAD", HEAD, "/agents/agent/stream"],
  ["OPTIONS", OPTIONS, "/agents/agent/stream"],
] as const)(
  "denies unused native route %s %s %s",
  async (method, handler, path) => {
    const response = await handler(
      new Request(`http://localhost:3002/api/mastra${path}`, { method })
    );
    expect(response.status).toBe(404);
  }
);

it.each([
  null,
  [],
  { messages: userMessages },
  { memory: null, messages: userMessages },
  { memory: { thread: 42 }, messages: userMessages },
  { memory: { thread: "" }, messages: userMessages },
  { memory: { thread: { id: crypto.randomUUID() } }, messages: userMessages },
  { memory: { thread: crypto.randomUUID() }, messages: [] },
  { memory: { thread: crypto.randomUUID() }, messages: "Hello" },
  { memory: { thread: crypto.randomUUID() }, messages: [{}] },
])(
  "rejects malformed chat input before storage or execution: %j",
  async (body) => {
    const agent = mastra.getAgentById("agent");
    const stream = vi.spyOn(agent, "stream");
    const memory = await agent.getMemory();
    if (!memory) {
      throw new Error("Memory fixture missing");
    }
    const save = vi.spyOn(memory, "saveMessages");
    const response = await POST(
      new Request("http://localhost:3002/api/mastra/agents/agent/stream", {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(response.status).toBe(400);
    expect(save).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  }
);

it.each([
  "text/plain",
  "application/x-www-form-urlencoded",
  "application/json-invalid",
])(
  "rejects chat content type %s instead of bypassing authorization",
  async (contentType) => {
    const response = await POST(
      new Request("http://localhost:3002/api/mastra/agents/agent/stream", {
        body: JSON.stringify({
          memory: { thread: crypto.randomUUID() },
          messages: userMessages,
        }),
        headers: { "Content-Type": contentType },
        method: "POST",
      })
    );
    expect(response.status).toBe(415);
  }
);

it("refuses message IDs stored in another conversation before saving turn input", async () => {
  const memory = await mastra.getAgentById("agent").getMemory();
  const storage = await mastra.getStorage()?.getStore("memory");
  if (!(memory && storage)) {
    throw new Error("Memory fixture missing");
  }
  const threadId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  await memory.createThread({ resourceId: "user-2", threadId });
  await memory.saveMessages({
    messages: [
      {
        content: {
          format: 2,
          parts: [{ text: "Private prompt", type: "text" }],
        },
        createdAt: new Date(),
        id: messageId,
        resourceId: "user-2",
        role: "user",
        threadId,
      },
    ],
  });
  const stream = vi.spyOn(mastra.getAgentById("agent"), "stream");
  const response = await POST(
    streamRequest({
      memory: { thread: crypto.randomUUID() },
      messages: [
        {
          id: messageId,
          parts: [{ text: "Replace victim message", type: "text" }],
          role: "user",
        },
      ],
    })
  );
  expect(response.status).toBe(403);
  expect(stream).not.toHaveBeenCalled();
  expect(
    (await storage.listMessagesById({ messageIds: [messageId] })).messages[0]
  ).toMatchObject({
    content: { parts: [{ text: "Private prompt", type: "text" }] },
    resourceId: "user-2",
    threadId,
  });
});

it("rejects invalid JSON without throwing", async () => {
  const response = await POST(
    new Request("http://localhost:3002/api/mastra/agents/agent/stream", {
      body: "{",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );
  expect(response.status).toBe(400);
});

it("stores the conversation under the signed-in account, not the one requested", async () => {
  vi.stubEnv("OPENCODE_API_KEY", "test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(() => Promise.resolve(providerStream()))
  );
  const threadId = crypto.randomUUID();
  const streamSpy = vi.spyOn(mastra.getAgentById("agent"), "stream");

  const response = await POST(
    streamRequest(
      {
        memory: {
          options: { lastMessages: 1000 },
          resource: "user-2",
          thread: threadId,
        },
        messages: userMessages,
        requestContext: {
          mastra__resourceId: "user-2",
          mastra__threadId: crypto.randomUUID(),
          opencodeSessionId: crypto.randomUUID(),
          threadId: crypto.randomUUID(),
        },
        resourceId: "user-2",
        runId: "injected-run",
        threadId: crypto.randomUUID(),
      },
      `?requestContext=${encodeURIComponent(JSON.stringify({ mastra__resourceId: "user-2", threadId: crypto.randomUUID() }))}&resourceId=user-2&runId=injected-run`
    )
  );
  await response.text();

  const memory = await mastra.getAgentById("agent").getMemory();
  const thread = await memory?.getThreadById({ threadId });
  expect(thread?.resourceId).toBe(signedInUserId);
  expect(streamSpy).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      memory: { resource: signedInUserId, thread: threadId },
      requestContext: expect.toSatisfy(
        (context: RequestContext) =>
          context.get("threadId") === threadId &&
          context.get("opencodeSessionId") === threadId
      ),
    })
  );
  expect(streamSpy).toHaveBeenCalledWith(
    expect.anything(),
    expect.not.objectContaining({ runId: "injected-run" })
  );
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
    body: { memory: { thread: sessionId } },
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

it("denies agent discovery through the native API prefix", async () => {
  const response = await GET(
    new Request("http://localhost:3002/api/mastra/agents")
  );

  expect(response.status).toBe(404);
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
  await (await mastra.getAgentById("agent").getMemory())?.createThread({
    resourceId: signedInUserId,
    threadId: sessionId,
    title: "Existing conversation",
  });
  const transport = new MastraChatTransport({
    api: "http://localhost:3002/api/mastra/agents/agent/stream",
    fetch: async (input, init) => await POST(new Request(input, init)),
  });
  const messages: UIMessage[] = [
    {
      id: crypto.randomUUID(),
      parts: [{ text: "Hello", type: "text" }],
      role: "user",
    },
  ];

  const firstReply = await readChatReply(transport, messages, sessionId);
  messages.push(firstReply, {
    id: crypto.randomUUID(),
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
    const threadId = crypto.randomUUID();
    await (await mastra.getAgentById("agent").getMemory())?.createThread({
      resourceId: signedInUserId,
      threadId,
      title: "Existing conversation",
    });
    const startedAt = Date.now();
    const stream = await transport.sendMessages({
      abortSignal: undefined,
      body: { memory: { thread: threadId } },
      chatId: crypto.randomUUID(),
      messageId: undefined,
      messages: [
        {
          id: crypto.randomUUID(),
          parts: [{ text: "Hello", type: "text" }],
          role: "user",
        },
      ],
      trigger: "submit-message",
    });
    const deltas: { text: string; time: number }[] = [];
    let finished = false;
    const consumed = (async () => {
      for await (const chunk of stream) {
        if (chunk.type === "text-delta") {
          deltas.push({ text: chunk.delta, time: Date.now() - startedAt });
        }
      }
      finished = true;
    })();

    await vi.waitFor(
      async () => {
        await vi.runAllTimersAsync();
        expect(finished).toBe(true);
      },
      { interval: 0 }
    );
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
        memory: { thread: crypto.randomUUID() },
        messages: [
          {
            id: crypto.randomUUID(),
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
    new Request("http://localhost:3002/api/mastra/agents/agent/stream", {
      body: JSON.stringify({ memory: { thread: crypto.randomUUID() } }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );

  expect(response.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});
