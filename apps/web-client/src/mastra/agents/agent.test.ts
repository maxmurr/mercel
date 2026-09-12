// @vitest-environment node

import { RequestContext } from "@mastra/core/request-context";
import { afterEach, expect, it, vi } from "vitest";
import { mastra } from "../index";
import { designBrief } from "../processors/design-brief";

vi.mock("@/features/user/user-auth", () => ({
  auth: {
    api: { getSession: () => Promise.resolve({ user: { id: "user-1" } }) },
  },
}));

const completionResponse = {
  choices: [
    {
      finish_reason: "stop",
      index: 0,
      message: { content: "Hello!", role: "assistant" },
    },
  ],
  created: 0,
  id: "test-completion",
  model: "glm-5.3-flash",
  object: "chat.completion",
  usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("registers Agent with GLM 5.3 Flash through OpenCode Go", async () => {
  const agent = mastra.getAgentById("agent");
  const model = await agent.getModel();

  expect(agent.name).toBe("Agent");
  expect(model.provider).toBe("opencode-go");
  expect(model.modelId).toBe("glm-5.3-flash");
});

it("sends OpenCode Go session and client headers on the actual model request", async () => {
  vi.stubEnv("OPENCODE_API_KEY", "test-key");
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json(completionResponse));
  vi.stubGlobal("fetch", fetchMock);

  const response = await mastra.getAgentById("agent").generate("Hello");
  expect(response.text).toBe("Hello!");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [call] = fetchMock.mock.calls;
  expect(call).toBeDefined();
  if (!call) {
    throw new Error("Missing provider request");
  }
  const request = new Request(...call);
  expect(request.url).toBe("https://opencode.ai/zen/go/v1/chat/completions");
  expect(request.headers.get("x-opencode-session")).toBeTruthy();
  expect(request.headers.get("user-agent")).toContain("mercel/0.1.0");
  expect(request.headers.get("authorization")).toBe("Bearer test-key");
});

it.each([undefined, "86d8bb97-5293-47c7-9c19-1b53bbf6b17d"])(
  "keeps session %# stable without sharing it between independent runs",
  async (sessionId) => {
    vi.stubEnv("OPENCODE_API_KEY", "test-key");
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(completionResponse))
    );
    vi.stubGlobal("fetch", fetchMock);
    const agent = mastra.getAgentById("agent");
    const requestContext = new RequestContext();
    if (sessionId) {
      requestContext.set("opencodeSessionId", sessionId);
    }

    await agent.generate("First turn", { requestContext });
    await agent.generate("Second turn", { requestContext });
    await Promise.all([
      agent.generate("Independent conversation A"),
      agent.generate("Independent conversation B"),
    ]);

    const sessionIds = fetchMock.mock.calls.map((call) =>
      new Request(...call).headers.get("x-opencode-session")
    );
    expect(sessionIds).toHaveLength(4);
    const conversationSessionId =
      sessionId ?? requestContext.getRaw("opencodeSessionId");
    expect(sessionIds.slice(0, 2)).toEqual([
      conversationSessionId,
      conversationSessionId,
    ]);
    expect(sessionIds.every(Boolean)).toBe(true);
    expect(new Set(sessionIds).size).toBe(3);
  }
);

it("names threads with its own instructions and a session of its own", async () => {
  const memory = await mastra.getAgentById("agent").getMemory();
  const { generateTitle } = memory?.getMergedThreadConfig() ?? {};

  if (typeof generateTitle !== "object") {
    throw new Error("Title generation is not configured");
  }
  expect(generateTitle.instructions).toContain(
    "Never copy, quote, or summarise the assistant's reply."
  );

  const { model } = generateTitle;
  if (typeof model !== "function") {
    throw new Error("Title model is not resolved per request");
  }
  const sessionHeaderOf = () => {
    const resolved = model({ mastra, requestContext: new RequestContext() });
    if (typeof resolved !== "object" || !("headers" in resolved)) {
      throw new Error("Title model resolved without OpenCode headers");
    }
    return resolved.headers?.["x-opencode-session"];
  };

  const [first, second] = [sessionHeaderOf(), sessionHeaderOf()];
  expect(first).toBeTruthy();
  expect(second).not.toBe(first);
});

it("merges Exa MCP tools with the built-in tools", async () => {
  const tools = await mastra.getAgentById("agent").listTools();

  expect(Object.keys(tools)).toEqual([
    "ask_user",
    "web_fetch",
    "exa_web_search_exa",
    "open_preview",
  ]);
});

it("rejects invalid routing session IDs before calling the provider", async () => {
  vi.stubEnv("OPENCODE_API_KEY", "test-key");
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);

  await expect(
    mastra.getAgentById("agent").generate("Hello", {
      requestContext: new RequestContext([["opencodeSessionId", "invalid"]]),
    })
  ).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("prefixes only the first user message with the design brief", async () => {
  vi.stubEnv("OPENCODE_API_KEY", "test-key");
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json(completionResponse));
  vi.stubGlobal("fetch", fetchMock);

  await mastra.getAgentById("agent").generate([
    { content: "Build a landing page", role: "user" },
    { content: "Done", role: "assistant" },
    { content: "Make it blue", role: "user" },
  ]);

  const [call] = fetchMock.mock.calls;
  if (!call) {
    throw new Error("Missing provider request");
  }
  expect(await new Request(...call).json()).toMatchObject({
    messages: expect.arrayContaining([
      expect.objectContaining({
        content: `${designBrief}Build a landing page`,
        role: "user",
      }),
      expect.objectContaining({ content: "Make it blue", role: "user" }),
    ]),
  });
});
