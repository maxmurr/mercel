import { startDeployment } from "@/lib/deployment";
import { threadAccess } from "@/lib/thread-access";
import { archiveThreadWorkspace } from "@/mastra/thread-workspace";

export const runtime = "nodejs";

/**
 * Publishes one thread's sandbox: archives it here, where the files are, and
 * hands the archive to the upload server, which builds and hosts it.
 *
 * The browser gets back only the deployment ID and polls the upload server for
 * status itself. The files belong to the conversation, so the account that owns
 * the thread is the one that publishes them.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/workspace/[threadId]/publish">
) {
  const { threadId } = await params;
  const access = await threadAccess(request, threadId);
  if (access instanceof Response) {
    return access;
  }

  try {
    const archive = await archiveThreadWorkspace(threadId);
    if (!archive) {
      return Response.json(
        { error: "Nothing to publish yet" },
        { status: 404 }
      );
    }
    return Response.json(await startDeployment(archive));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Publish failed" },
      { status: 500 }
    );
  }
}
