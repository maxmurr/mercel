import { threadAccess } from "@/features/chat/chat-thread-access";
import { readProcessLogs } from "@/features/workspace/workspace-process-log";
import { existingThreadSandbox } from "@/mastra/thread-workspace";

/**
 * Serves background process output recorded by the agent's sandbox; `after` is
 * the last seen seq.
 *
 * Every thread runs its own sandbox but they all record into one buffer, and
 * the callback that records an entry only knows its PID. So the thread's own
 * output is picked out here, by the processes its sandbox owns. A process that
 * the sandbox has already dismissed takes its last entries with it.
 *
 * The output is the thread's, so only the account that owns the thread reads it.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/sandbox/logs/[threadId]">
) {
  const { threadId } = await params;
  const access = await threadAccess(request, threadId);
  if (access instanceof Response) {
    return access;
  }

  const after = Number(new URL(request.url).searchParams.get("after") ?? 0);
  const sandbox = existingThreadSandbox(threadId);
  if (!sandbox) {
    return Response.json({ entries: [] });
  }

  const processes = await sandbox.processes.list();
  const pids = new Set(processes.map((process) => String(process.pid)));
  return Response.json({
    entries: readProcessLogs(after).filter((entry) => pids.has(entry.pid)),
  });
}
