import { threadAccess } from "@/lib/thread-access";
import { zipThreadWorkspace } from "@/mastra/thread-workspace";

export const runtime = "nodejs";

/**
 * Sends one thread's sandbox to the browser as a zip download.
 *
 * The files belong to the conversation, so the account that owns the thread is
 * the one that downloads them.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/workspace/[threadId]/export">
) {
  const { threadId } = await params;
  const access = await threadAccess(request, threadId);
  if (access instanceof Response) {
    return access;
  }

  try {
    const archive = await zipThreadWorkspace(threadId);
    if (!archive) {
      return Response.json({ error: "Nothing to export yet" }, { status: 404 });
    }
    return new Response(archive, {
      headers: {
        "Content-Disposition": 'attachment; filename="project.zip"',
        "Content-Type": "application/zip",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Export failed" },
      { status: 500 }
    );
  }
}
