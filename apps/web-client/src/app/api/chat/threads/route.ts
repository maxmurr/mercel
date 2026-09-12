import { auth } from "@/lib/auth";
import { mastra } from "@/mastra";

export const runtime = "nodejs";

/** One page is all the sidebar shows; older conversations stay reachable by URL. */
const threadsPerPage = 50;

/**
 * Lists the signed-in account's conversations, newest first, for the thread
 * sidebar. A thread started while signed out is stored under its own ID rather
 * than an account, so a visitor without one has nothing to list.
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  const resourceId = session?.user.id;
  if (!resourceId) {
    return Response.json({ threads: [] });
  }

  const memory = await mastra.getAgentById("agent").getMemory();
  if (!memory) {
    return Response.json({ threads: [] });
  }

  const { threads } = await memory.listThreads({
    filter: { resourceId },
    orderBy: { direction: "DESC", field: "updatedAt" },
    perPage: threadsPerPage,
  });

  return Response.json({
    threads: threads.map((thread) => ({
      id: thread.id,
      title: thread.title ?? "",
      updatedAt: thread.updatedAt,
    })),
  });
}
