import { type ParseResult, parseJsonEventStream } from "@ai-sdk/provider-utils";
import { HttpChatTransport, type UIMessage, type UIMessageChunk } from "ai";
import { z } from "zod";

const mastraChunkSchema = z.object({
  payload: z.unknown().optional(),
  type: z.string(),
});
type MastraChunk = z.infer<typeof mastraChunkSchema>;

const partPayloadSchema = z.object({
  id: z.string().default("part"),
  text: z.string().default(""),
});

const toolPayloadSchema = z.object({
  args: z.unknown().optional(),
  argsTextDelta: z.string().default(""),
  error: z.unknown().optional(),
  isError: z.boolean().default(false),
  result: z.unknown().optional(),
  toolCallId: z.string(),
  toolName: z.string().default(""),
});

type PartKind = "text" | "reasoning";

const partChunkKinds: Record<string, PartKind | undefined> = {
  "reasoning-delta": "reasoning",
  "reasoning-end": "reasoning",
  "reasoning-start": "reasoning",
  "text-delta": "text",
  "text-end": "text",
  "text-start": "text",
};

/** Drops Mastra's internal metadata so the UI shows only the arguments the model wrote. */
function toolInput(args: unknown) {
  if (typeof args !== "object" || args === null) {
    return args;
  }
  const { __mastraMetadata: _metadata, ...input } = args as Record<
    string,
    unknown
  >;
  return input;
}

function errorText(error: unknown) {
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return JSON.stringify(error) ?? "Tool failed";
}

/** Maps one native Mastra tool chunk onto the AI SDK tool chunks the chat store understands. */
function toolChunks(type: string, payload: unknown): UIMessageChunk[] {
  const parsed = toolPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return [];
  }
  const tool = parsed.data;
  const { toolCallId, toolName } = tool;
  switch (type) {
    case "tool-call-input-streaming-start":
      return [{ toolCallId, toolName, type: "tool-input-start" }];
    case "tool-call-delta":
      return [
        {
          inputTextDelta: tool.argsTextDelta,
          toolCallId,
          type: "tool-input-delta",
        },
      ];
    case "tool-call":
      return [
        {
          input: toolInput(tool.args),
          toolCallId,
          toolName,
          type: "tool-input-available",
        },
      ];
    case "tool-call-approval":
      // Mastra may not emit tool-call first, so make sure the part exists before flagging it.
      return [
        {
          input: toolInput(tool.args),
          toolCallId,
          toolName,
          type: "tool-input-available",
        },
        { approvalId: toolCallId, toolCallId, type: "tool-approval-request" },
      ];
    case "tool-result":
      return tool.isError
        ? [
            {
              errorText: errorText(tool.result),
              toolCallId,
              type: "tool-output-error",
            },
          ]
        : [{ output: tool.result, toolCallId, type: "tool-output-available" }];
    case "tool-error":
      return [
        {
          errorText: errorText(tool.error),
          toolCallId,
          type: "tool-output-error",
        },
      ];
    case "tool-output-denied":
      return [{ toolCallId, type: "tool-output-denied" }];
    default:
      return [];
  }
}

/** Converts native Mastra SSE into AI SDK text, reasoning, and tool parts without a second API route. */
export class MastraChatTransport extends HttpChatTransport<UIMessage> {
  protected override processResponseStream(stream: ReadableStream<Uint8Array>) {
    // The AI SDK rejects deltas without a start chunk, so open parts are tracked
    // to synthesize missing starts and close whatever is still open at the end.
    const openParts = new Map<string, { id: string; kind: PartKind }>();

    return parseJsonEventStream({
      schema: mastraChunkSchema,
      stream,
    }).pipeThrough(
      new TransformStream<ParseResult<MastraChunk>, UIMessageChunk>({
        flush(controller) {
          for (const { id, kind } of openParts.values()) {
            controller.enqueue({ id, type: `${kind}-end` });
          }
          controller.enqueue({ type: "finish-step" });
          controller.enqueue({ type: "finish" });
        },
        start(controller) {
          controller.enqueue({ type: "start" });
          controller.enqueue({ type: "start-step" });
        },
        transform(chunk, controller) {
          if (!chunk.success) {
            throw new Error("Invalid Mastra chat stream", {
              cause: chunk.error,
            });
          }
          const { type, payload } = chunk.value;
          if (type === "error") {
            throw new Error("Mastra chat stream failed");
          }
          if (type.startsWith("tool-")) {
            for (const toolChunk of toolChunks(type, payload)) {
              controller.enqueue(toolChunk);
            }
            return;
          }
          const kind = partChunkKinds[type];
          if (!kind) {
            return;
          }
          const { id, text } = partPayloadSchema.parse(payload);
          const key = `${kind}:${id}`;
          if (type.endsWith("-end")) {
            openParts.delete(key);
            controller.enqueue({ id, type: `${kind}-end` });
            return;
          }
          if (!openParts.has(key)) {
            openParts.set(key, { id, kind });
            controller.enqueue({ id, type: `${kind}-start` });
          }
          if (type.endsWith("-delta")) {
            controller.enqueue({ delta: text, id, type: `${kind}-delta` });
          }
        },
      })
    );
  }
}
