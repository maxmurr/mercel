// @vitest-environment node

import type { UIMessage, UIMessageChunk } from "ai";
import { expect, it, vi } from "vitest";
import {
  createChatTransport,
  MastraChatTransport,
  toolApprovalRequest,
} from "@/features/chat/chat-transport";

function mastraResponse(chunks: unknown[]) {
  return new Response(
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(""),
    { headers: { "Content-Type": "text/event-stream" } }
  );
}

async function sendAndCollect(mastraChunks: unknown[]) {
  const transport = new MastraChatTransport({
    api: "http://localhost:3002/api/mastra/agents/agent/stream",
    fetch: () => Promise.resolve(mastraResponse(mastraChunks)),
  });
  const stream = await transport.sendMessages({
    abortSignal: undefined,
    chatId: "chat",
    messageId: undefined,
    messages: [
      { id: "user-1", parts: [{ text: "Go", type: "text" }], role: "user" },
    ],
    trigger: "submit-message",
  });
  const chunks: UIMessageChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

it("forwards Mastra data chunks as transient AI SDK data parts", async () => {
  const chunks = await sendAndCollect([
    { type: "start" },
    {
      data: { output: "ready\n", timestamp: 1 },
      transient: true,
      type: "data-sandbox-stdout",
    },
    { payload: { id: "text-1", text: "Done" }, type: "text-delta" },
    { data: { url: "http://localhost:5173" }, type: "data-preview" },
    { type: "finish" },
  ]);

  expect(chunks).toEqual(
    expect.arrayContaining([
      {
        data: { output: "ready\n", timestamp: 1 },
        transient: true,
        type: "data-sandbox-stdout",
      },
      {
        data: { url: "http://localhost:5173" },
        transient: true,
        type: "data-preview",
      },
      { delta: "Done", id: "text-1", type: "text-delta" },
    ])
  );
});

it("packs the run id into the approval id so the answer can resume the run", async () => {
  const chunks = await sendAndCollect([
    {
      payload: {
        args: { path: "src/App.css" },
        toolCallId: "call-1",
        toolName: "mastra_workspace_delete",
      },
      runId: "run-1",
      type: "tool-call-approval",
    },
  ]);

  expect(chunks).toEqual(
    expect.arrayContaining([
      {
        input: { path: "src/App.css" },
        toolCallId: "call-1",
        toolName: "mastra_workspace_delete",
        type: "tool-input-available",
      },
      {
        approvalId: "run-1::call-1",
        toolCallId: "call-1",
        type: "tool-approval-request",
      },
    ])
  );
});

it("routes an answered approval to Mastra's approve or decline route", () => {
  const messages = (approval: {
    approved: boolean;
    id: string;
    reason?: string;
  }): UIMessage[] => [
    {
      id: "user-1",
      parts: [{ text: "Delete it", type: "text" }],
      role: "user",
    },
    {
      id: "assistant-1",
      parts: [
        {
          approval,
          input: { path: "src/App.css" },
          state: "approval-responded",
          toolCallId: "call-1",
          toolName: "mastra_workspace_delete",
          type: "dynamic-tool",
        },
      ],
      role: "assistant",
    },
  ];

  expect(
    toolApprovalRequest(messages({ approved: true, id: "run-1::call-1" }))
  ).toEqual({
    body: { runId: "run-1", toolCallId: "call-1" },
    route: "approve-tool-call",
  });
  expect(
    toolApprovalRequest(
      messages({ approved: false, id: "run-1::call-1", reason: "Keep it" })
    )
  ).toEqual({
    body: { reason: "Keep it", runId: "run-1", toolCallId: "call-1" },
    route: "decline-tool-call",
  });
  expect(
    toolApprovalRequest(messages({ approved: true, id: "call-1" }))
  ).toBeUndefined();
  expect(
    toolApprovalRequest(
      messages({ approved: true, id: "run-1::call-1" }).slice(0, 1)
    )
  ).toBeUndefined();
});

it("sends only the newest message with the thread and its owner", async () => {
  const fetchMock = vi.fn<typeof fetch>(() =>
    Promise.resolve(mastraResponse([{ type: "finish" }]))
  );
  vi.stubGlobal("fetch", fetchMock);
  const messages: UIMessage[] = [
    { id: "user-1", parts: [{ text: "Hello", type: "text" }], role: "user" },
    {
      id: "assistant-1",
      parts: [{ text: "Hi", type: "text" }],
      role: "assistant",
    },
    { id: "user-2", parts: [{ text: "Again", type: "text" }], role: "user" },
  ];

  await createChatTransport("user-1").sendMessages({
    abortSignal: undefined,
    chatId: "thread-1",
    messageId: undefined,
    messages,
    trigger: "submit-message",
  });

  const call = fetchMock.mock.calls.at(0);
  if (!call) {
    throw new Error("Chat request missing");
  }
  expect(String(call[0])).toBe("/api/mastra/agents/agent/stream");
  expect(JSON.parse(String(call[1]?.body))).toEqual({
    memory: { resource: "user-1", thread: "thread-1" },
    messages: [messages[2]],
    requestContext: { opencodeSessionId: "thread-1", threadId: "thread-1" },
  });

  vi.unstubAllGlobals();
});

it("turns ask_user suspension into a questionnaire and routes answers to resume-stream", async () => {
  const input = {
    questions: [
      {
        id: "notes",
        label: "Notes",
        question: "Any constraints?",
        required: false,
        type: "text",
      },
    ],
    submitLabel: "Send answers",
  };
  const chunks = await sendAndCollect([
    {
      payload: {
        suspendPayload: input,
        toolCallId: "ask-1",
        toolName: "ask_user",
      },
      runId: "run-1",
      type: "tool-call-suspended",
    },
  ]);
  expect(chunks).toEqual(
    expect.arrayContaining([
      {
        input,
        toolCallId: "ask-1",
        toolName: "ask_user",
        type: "tool-input-available",
      },
      {
        approvalId: "run-1::ask-1",
        toolCallId: "ask-1",
        type: "tool-approval-request",
      },
    ])
  );
  const resumeData = { answers: { notes: "EU data residency" } };
  const fetchMock = vi.fn<typeof fetch>(() =>
    Promise.resolve(mastraResponse([{ type: "finish" }]))
  );
  vi.stubGlobal("fetch", fetchMock);
  try {
    await createChatTransport("owner-1").sendMessages({
      abortSignal: undefined,
      chatId: "thread-1",
      messageId: undefined,
      messages: [
        {
          id: "assistant-1",
          parts: [
            {
              approval: {
                approved: true,
                id: "run-1::ask-1",
                reason: JSON.stringify(resumeData),
              },
              input,
              state: "approval-responded",
              toolCallId: "ask-1",
              toolName: "ask_user",
              type: "dynamic-tool",
            },
          ],
          role: "assistant",
        },
      ],
      trigger: "submit-message",
    });
    const [call] = fetchMock.mock.calls;
    expect(call?.[0]).toBe("/api/mastra/agents/agent/resume-stream");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      memory: { resource: "owner-1", thread: "thread-1" },
      requestContext: { opencodeSessionId: "thread-1", threadId: "thread-1" },
      resumeData,
      runId: "run-1",
      toolCallId: "ask-1",
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
