import { threadAccess } from "@/features/chat/chat-thread-access";
import { resumableRunId } from "@/features/chat/chat-thread-run";
import { mastra } from "@/mastra";

/**
 * Chunk types that close a turn: the run finished, failed, was stopped, or
 * suspended waiting for the user to answer a tool approval. The subscription
 * itself stays open for the thread's next turn, so the reply has to end here.
 */
const turnEndChunks = new Set([
  "abort",
  "error",
  "finish",
  "tool-call-approval",
  "tool-call-suspended",
]);

/**
 * Re-attaches to the reply the thread is still generating, replaying it from
 * the first chunk so a reloaded chat catches up on what it missed.
 *
 * A run outlives the request that started it, so a reload or a dropped
 * connection costs the stream but not the reply. An empty 204 tells the chat
 * there is nothing to resume.
 *
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/chat/[threadId]/stream">
) {
  const { threadId } = await params;
  const access = await threadAccess(request, threadId);
  if (access instanceof Response) {
    return access;
  }

  const resourceId = access.userId;
  if (!(await resumableRunId(resourceId, threadId))) {
    return new Response(null, { status: 204 });
  }

  const subscription = await mastra
    .getAgentById("agent")
    .subscribeToThread({ resourceId, threadId });
  const chunks = subscription.stream[Symbol.asyncIterator]();
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        subscription.unsubscribe();
      },
      async pull(controller) {
        const { done, value } = await chunks.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(value)}\n\n`)
        );
        if (turnEndChunks.has(value.type)) {
          // Ends the subscription rather than waiting for the thread's next turn.
          await chunks.return?.();
          controller.close();
        }
      },
    }),
    {
      headers: {
        "Cache-Control": "no-cache",
        "Content-Type": "text/event-stream",
      },
    }
  );
}

/** Stops the running reply, so a stop reaches the model and not just this browser. */
export async function DELETE(
  request: Request,
  { params }: RouteContext<"/api/chat/[threadId]/stream">
) {
  const { threadId } = await params;
  const access = await threadAccess(request, threadId);
  if (access instanceof Response) {
    return access;
  }

  mastra
    .getAgentById("agent")
    .abortThreadStream({ resourceId: access.userId, threadId });
  return new Response(null, { status: 204 });
}
