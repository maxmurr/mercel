import { threadAccess } from "@/features/chat/chat-thread-access";
import { startDeployment } from "@/features/workspace/workspace-deployment";
import { mastra } from "@/mastra";
import { archiveThreadWorkspace } from "@/mastra/thread-workspace";

export const runtime = "nodejs";

/**
 * Publishes one thread's sandbox: archives it here, where the files are, and
 * hands the archive to the upload server, which builds and hosts it.
 *
 * The browser gets back only the deployment ID and polls the upload server for
 * status itself. The files belong to the conversation, so the account that owns
 * the thread is the one that publishes them. The ID is kept on the thread so a
 * reloaded page can still reach the site this thread published.
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
    const published = access.thread?.metadata?.deploymentId;
    const deployment = await startDeployment(
      archive,
      typeof published === "string" ? published : undefined
    );
    if (access.thread) {
      const memory = await mastra.getAgentById("agent").getMemory();
      await memory?.updateThread({
        id: threadId,
        metadata: { deploymentId: deployment.id },
      });
    }
    return Response.json(deployment);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Publish failed" },
      { status: 500 }
    );
  }
}
