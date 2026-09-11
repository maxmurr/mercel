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

type PartKind = "text" | "reasoning";

const partChunkKinds: Record<string, PartKind | undefined> = {
  "reasoning-delta": "reasoning",
  "reasoning-end": "reasoning",
  "reasoning-start": "reasoning",
  "text-delta": "text",
  "text-end": "text",
  "text-start": "text",
};

/** Converts native Mastra SSE into AI SDK text and reasoning parts without a second API route. */
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
