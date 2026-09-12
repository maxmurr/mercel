import { threadAccess } from "@/lib/thread-access";
import { threadFilesystem } from "@/mastra/thread-workspace";

export const runtime = "nodejs";

/**
 * Browses one thread's sandbox files for the Code tab.
 *
 * Mastra's own workspace routes read the statically configured filesystem, and
 * this agent resolves one per thread instead, so the thread has to be named in
 * the path. The files belong to the conversation, so the account that owns the
 * thread is the one that reads them.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/workspace/[threadId]/[action]">
) {
  const { action, threadId } = await params;
  const access = await threadAccess(request, threadId);
  if (access instanceof Response) {
    return access;
  }

  const path = new URL(request.url).searchParams.get("path");
  if (!path) {
    return Response.json({ error: "Path is required" }, { status: 400 });
  }

  try {
    // Contained to the thread's directory, so a crafted path cannot climb out of it.
    const filesystem = threadFilesystem(threadId);
    if (action === "list") {
      return Response.json({ entries: await filesystem.readdir(path) });
    }
    if (action === "read") {
      return Response.json({
        content: await filesystem.readFile(path, { encoding: "utf8" }),
      });
    }
    return Response.json(
      { error: `Unknown action: ${action}` },
      { status: 404 }
    );
  } catch (error) {
    // A thread that has not built anything yet has no directory; the Code tab reads that as empty.
    return Response.json(
      { error: error instanceof Error ? error.message : "Request failed" },
      { status: 404 }
    );
  }
}
