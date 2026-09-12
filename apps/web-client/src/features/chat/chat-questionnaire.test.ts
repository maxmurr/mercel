// @vitest-environment node

import { createTool } from "@mastra/core/tools";
import { afterEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/mastra/[...mastra]/route";
import { getChatThread } from "@/features/chat/chat-queries";
import {
  parseQuestionnaireAnswers,
  questionnaireInputSchema,
  questionnaireOutputSchema,
} from "@/features/chat/chat-questionnaire";
import { mastra } from "@/mastra";

let userId: string | undefined = "questionnaire-owner";
vi.mock("@/features/user/user-auth", () => ({
  auth: {
    api: {
      getSession: () =>
        Promise.resolve(userId ? { user: { id: userId } } : null),
    },
  },
}));

afterEach(() => {
  userId = "questionnaire-owner";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const input = questionnaireInputSchema.parse({
  questions: [
    {
      id: "priority",
      label: "Priority",
      options: [{ label: "Speed" }, { label: "Cost" }],
      question: "What matters most?",
      type: "single_select",
    },
    {
      id: "models",
      label: "Models",
      options: [{ label: "Usage-based" }, { label: "Per seat" }],
      question: "Which models?",
      type: "multi_select",
    },
    {
      id: "notes",
      label: "Notes",
      question: "Any constraints?",
      required: false,
      type: "text",
    },
  ],
});
const output = {
  answers: {
    models: ["Usage-based", "Per seat"],
    notes: null,
    priority: "Cost",
  },
};

it.each([
  { ...output.answers, priority: "Unknown" },
  { ...output.answers, models: ["Usage-based", "Usage-based"] },
  { ...output.answers, models: [] },
  { ...output.answers, priority: null },
  { ...output.answers, extra: "Injected" },
])("rejects answers outside the stored questionnaire: %o", (answers) => {
  expect(() => parseQuestionnaireAnswers(input, { answers })).toThrow();
});

it("accepts valid answers and rejects duplicate question IDs", () => {
  expect(parseQuestionnaireAnswers(input, output)).toEqual(output);
  expect(
    questionnaireInputSchema.safeParse({
      questions: [input.questions[0], input.questions[0]],
    }).success
  ).toBe(false);
});

function request(route: string, body: unknown) {
  return new Request(`http://localhost:3002/api/mastra/agents/agent/${route}`, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

function providerResponse(toolCall: boolean) {
  const delta = toolCall
    ? {
        role: "assistant",
        tool_calls: [
          {
            function: { arguments: JSON.stringify(input), name: "ask_user" },
            id: "questionnaire-call",
            index: 0,
            type: "function",
          },
        ],
      }
    : { content: "I will use your answers.", role: "assistant" };
  const chunks = [
    { choices: [{ delta, finish_reason: null, index: 0 }] },
    {
      choices: [
        {
          delta: {},
          finish_reason: toolCall ? "tool_calls" : "stop",
          index: 0,
        },
      ],
    },
  ];
  return new Response(
    `${chunks.map((chunk) => `data: ${JSON.stringify({ ...chunk, created: 0, id: "completion", model: "glm-5.3-flash", object: "chat.completion.chunk" })}\n\n`).join("")}data: [DONE]\n\n`,
    {
      headers: { "Content-Type": "text/event-stream" },
    }
  );
}

it("suspends, reloads the form, validates ownership, resumes, and reloads confirmed answers", async () => {
  vi.stubEnv("OPENCODE_API_KEY", "test-key");
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(providerResponse(true))
      .mockImplementation(() => Promise.resolve(providerResponse(false)))
  );
  const threadId = crypto.randomUUID();
  const memory = { resource: userId, thread: threadId };
  const response = await POST(
    request("stream", {
      memory,
      messages: [
        {
          id: crypto.randomUUID(),
          parts: [{ text: "Ask about my project.", type: "text" }],
          role: "user",
        },
      ],
      requestContext: { opencodeSessionId: threadId, threadId },
    })
  );
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("tool-call-suspended");
  const loaded = await getChatThread(threadId, new Headers());
  if (loaded instanceof Response) {
    throw new Error("Questionnaire history was refused");
  }
  const question = loaded.messages
    .flatMap((message) => message.parts)
    .find(
      (part) => part.type === "dynamic-tool" && part.toolName === "ask_user"
    );
  expect(question).toMatchObject({ input, state: "approval-requested" });
  if (
    question?.type !== "dynamic-tool" ||
    question.state !== "approval-requested"
  ) {
    throw new Error("Questionnaire suspension missing from history");
  }
  const body = {
    memory,
    resumeData: output,
    runId: question.approval.id.split("::")[0],
    toolCallId: question.toolCallId,
  };
  userId = "another-account";
  expect((await POST(request("resume-stream", body))).status).toBe(403);
  expect(
    (
      await POST(
        request("resume-stream", {
          ...body,
          memory: { thread: crypto.randomUUID() },
        })
      )
    ).status
  ).toBe(409);
  userId = undefined;
  expect((await POST(request("resume-stream", body))).status).toBe(401);
  userId = "questionnaire-owner";
  expect(
    (
      await POST(
        request("resume-stream", { ...body, resumeData: { answers: {} } })
      )
    ).status
  ).toBe(400);
  expect((await POST(request("approve-tool-call", body))).status).toBe(409);
  expect((await POST(request("decline-tool-call", body))).status).toBe(409);
  const resumed = await POST(request("resume-stream", body));
  expect(resumed.status).toBe(200);
  const resumedText = await resumed.text();
  expect(resumedText).toContain("tool-result");
  expect(resumedText).toContain("Usage-based");

  const saved = await getChatThread(threadId, new Headers());
  if (saved instanceof Response) {
    throw new Error("Questionnaire answer history was refused");
  }
  expect(saved.messages.flatMap((message) => message.parts)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        output,
        state: "output-available",
        toolCallId: question.toolCallId,
      }),
    ])
  );
  expect((await POST(request("resume-stream", body))).status).toBe(409);
}, 20_000);

it.each(["approve-tool-call", "decline-tool-call"])(
  "checks session, thread, run, and tool ownership before %s",
  async (route) => {
    const agent = mastra.getAgentById("agent");
    const execute = vi.fn(() => Promise.resolve(output));
    const tools = await agent.listTools();
    vi.spyOn(agent, "listTools").mockResolvedValue({
      ...tools,
      ask_user: createTool({
        description: "Approval test tool",
        execute,
        id: "ask_user",
        inputSchema: questionnaireInputSchema,
        outputSchema: questionnaireOutputSchema,
        requireApproval: true,
        resumeSchema: questionnaireOutputSchema,
        suspendSchema: questionnaireInputSchema,
      }),
    });
    vi.stubEnv("OPENCODE_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(providerResponse(true))
        .mockImplementation(() => Promise.resolve(providerResponse(false)))
    );
    const threadId = crypto.randomUUID();
    await (await agent.getMemory())?.createThread({
      resourceId: "questionnaire-owner",
      threadId,
      title: "Approval test",
    });
    const memory = { thread: threadId };
    const started = await POST(
      request("stream", {
        memory,
        messages: [
          {
            id: crypto.randomUUID(),
            parts: [{ text: "Ask me first", type: "text" }],
            role: "user",
          },
        ],
      })
    );
    expect(await started.text()).toContain("tool-call-approval");
    const { runs } = await agent.listSuspendedRuns({
      resourceId: "questionnaire-owner",
      threadId,
    });
    const [run] = runs;
    const toolCallId = run?.toolCalls[0]?.toolCallId;
    if (!(run && toolCallId)) {
      throw new Error("Approval fixture missing");
    }
    const body = { memory, runId: run.runId, toolCallId };
    userId = undefined;
    expect((await POST(request(route, body))).status).toBe(401);
    userId = "another-account";
    expect((await POST(request(route, body))).status).toBe(403);
    userId = "questionnaire-owner";
    expect(
      (
        await POST(
          request(route, { ...body, memory: { thread: crypto.randomUUID() } })
        )
      ).status
    ).toBe(409);
    expect(
      (await POST(request(route, { ...body, toolCallId: "other-call" }))).status
    ).toBe(409);
    expect(
      (await POST(request(route, { ...body, runId: "other-run" }))).status
    ).toBe(409);
    expect(
      (await POST(request(route, { ...body, memory: undefined }))).status
    ).toBe(400);
    expect(
      (await POST(request("resume-stream", { ...body, resumeData: output })))
        .status
    ).toBe(409);
    expect(execute).not.toHaveBeenCalled();

    const continued = await POST(
      request(route, { ...body, reason: "Keep it" })
    );
    expect(continued.status).toBe(200);
    await continued.text();
    expect(execute).toHaveBeenCalledTimes(
      route === "approve-tool-call" ? 1 : 0
    );
    expect((await POST(request(route, body))).status).toBe(409);
  }
);
