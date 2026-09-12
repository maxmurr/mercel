import type { StorageThreadType } from "@mastra/core/memory";
import { getUserSession } from "@/features/user/user-queries";
import { mastra } from "@/mastra";

interface ThreadAccess {
  /** The stored thread; absent until the agent saves the conversation's first turn. */
  thread: StorageThreadType | undefined;
  userId: string;
}

/**
 * Resolves the account allowed to act on a thread, or the refusal to return in
 * its place.
 *
 * A thread ID is not a capability: it travels in URLs and in request bodies, so
 * a thread stored under another account is refused even when its ID is known. A
 * thread the agent has not stored yet belongs to whoever is signed in, which is
 * what lets the first turn create it.
 */
export async function threadAccess(
  request: Pick<Request, "headers">,
  threadId?: string
): Promise<ThreadAccess | Response> {
  const session = await getUserSession(request.headers);
  const userId = session?.user.id;
  if (!userId) {
    return Response.json({ error: "Sign in required" }, { status: 401 });
  }
  if (!threadId) {
    return { thread: undefined, userId };
  }

  const memory = await mastra.getAgentById("agent").getMemory();
  const thread = (await memory?.getThreadById({ threadId })) ?? undefined;
  if (thread && thread.resourceId !== userId) {
    return Response.json(
      { error: "Thread belongs to another account" },
      { status: 403 }
    );
  }
  return { thread, userId };
}
