import { toAISdkMessages } from "@mastra/ai-sdk/ui";
import type { UIMessage } from "ai";
import { threadAccess } from "@/lib/thread-access";
import { resumableRunId } from "@/lib/thread-run";
import { mastra } from "@/mastra";
import { designBrief } from "@/mastra/processors/design-brief";

export const runtime = "nodejs";

/**
 * Hides the design brief the input processor prefixes onto the first user
 * message. The model is meant to read it as the user's own ask, but the user
 * never typed it, so it stays out of the conversation they see.
 */
function withoutDesignBrief(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) =>
      part.type === "text" && part.text.startsWith(designBrief)
        ? { ...part, text: part.text.slice(designBrief.length) }
        : part
    ),
  }));
}

/** Replays a stored conversation so a reloaded chat page shows its history. */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/chat/[threadId]/messages">
) {
  const { threadId } = await params;
  const access = await threadAccess(request, threadId);
  if (access instanceof Response) {
    return access;
  }

  const agent = mastra.getAgentById("agent");
  // Saves the chat a reconnect request on the threads that have nothing to replay.
  const isStreaming = Boolean(await resumableRunId(access.userId, threadId));
  const memory = await agent.getMemory();
  if (!(memory && access.thread)) {
    return Response.json({
      isStreaming,
      messages: [],
      resourceId: access.userId,
    });
  }

  const { messages } = await memory.recall({ perPage: false, threadId });
  return Response.json({
    isStreaming,
    messages: withoutDesignBrief(toAISdkMessages(messages, { version: "v7" })),
    resourceId: access.userId,
  });
}
