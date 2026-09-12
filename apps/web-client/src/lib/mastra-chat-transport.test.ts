// @vitest-environment node

import type { UIMessage, UIMessageChunk } from "ai";
import { expect, it } from "vitest";
import {
  MastraChatTransport,
  toolApprovalRequest,
} from "@/lib/mastra-chat-transport";

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
