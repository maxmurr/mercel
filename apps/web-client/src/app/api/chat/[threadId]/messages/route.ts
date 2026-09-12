import { toAISdkMessages } from "@mastra/ai-sdk/ui";
import type { UIMessage } from "ai";
import { auth } from "@/lib/auth";
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

/**
 * Owner of a thread's stored messages. Signed-in accounts own everything they
 * start; a thread opened while signed out owns itself, so it stays readable
 * without pooling anonymous conversations under one shared resource.
 */
function resourceIdFor(threadId: string, userId: string | undefined): string {
  return userId ?? threadId;
}

/** Replays a stored conversation so a reloaded chat page shows its history. */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/chat/[threadId]/messages">
) {
  const { threadId } = await params;
  const session = await auth.api.getSession({ headers: request.headers });
  const resourceId = resourceIdFor(threadId, session?.user.id);

  const memory = await mastra.getAgentById("agent").getMemory();
  const thread = await memory?.getThreadById({ threadId });
  if (!(memory && thread)) {
    return Response.json({ messages: [], resourceId });
  }
  if (thread.resourceId !== resourceId) {
    return Response.json(
      { error: "Thread belongs to another account" },
      {
        status: 403,
      }
    );
  }

  const { messages } = await memory.recall({ perPage: false, threadId });
  return Response.json({
    messages: withoutDesignBrief(toAISdkMessages(messages, { version: "v7" })),
    resourceId,
  });
}
