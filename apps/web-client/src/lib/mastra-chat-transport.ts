import { parseJsonEventStream } from "@ai-sdk/provider-utils";
import { TextStreamChatTransport, type UIMessage } from "ai";
import { z } from "zod";

const mastraChunkSchema = z.object({
  payload: z.unknown().optional(),
  type: z.string(),
});
const textDeltaSchema = z.object({ text: z.string() });

/** Converts native Mastra SSE into AI SDK text messages without a second API route. */
export class MastraChatTransport extends TextStreamChatTransport<UIMessage> {
  protected override processResponseStream(stream: ReadableStream<Uint8Array>) {
    const textStream = parseJsonEventStream({
      schema: mastraChunkSchema,
      stream,
    })
      .pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            if (!chunk.success) {
              throw new Error("Invalid Mastra chat stream", {
                cause: chunk.error,
              });
            }
            if (chunk.value.type === "error") {
              throw new Error("Mastra chat stream failed");
            }
            if (chunk.value.type === "text-delta") {
              controller.enqueue(
                textDeltaSchema.parse(chunk.value.payload).text
              );
            }
          },
        })
      )
      .pipeThrough(new TextEncoderStream());

    return super.processResponseStream(textStream);
  }
}
