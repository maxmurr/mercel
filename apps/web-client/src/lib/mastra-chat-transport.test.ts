// @vitest-environment node

import type { UIMessageChunk } from "ai";
import { expect, it } from "vitest";
import { MastraChatTransport } from "@/lib/mastra-chat-transport";

function mastraResponse(chunks: unknown[]) {
  return new Response(
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(""),
    { headers: { "Content-Type": "text/event-stream" } }
  );
}

it("forwards Mastra data chunks as transient AI SDK data parts", async () => {
  const transport = new MastraChatTransport({
    api: "http://localhost:3002/api/mastra/agents/agent/stream",
    fetch: () =>
      Promise.resolve(
        mastraResponse([
          { type: "start" },
          {
            data: { output: "ready\n", timestamp: 1 },
            transient: true,
            type: "data-sandbox-stdout",
          },
          { payload: { id: "text-1", text: "Done" }, type: "text-delta" },
          { data: { url: "http://localhost:5173" }, type: "data-preview" },
          { type: "finish" },
        ])
      ),
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
