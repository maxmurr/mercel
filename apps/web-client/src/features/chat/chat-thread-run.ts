import { mastra } from "@/mastra";

/**
 * The run a reconnecting chat can still be streamed, or nothing when the thread
 * has no reply in flight.
 *
 * A run suspended on a tool approval stays registered as the thread's active
 * run, but its stream has already ended and its messages are saved, so
 * replaying it would double every message the chat just loaded.
 */
export async function resumableRunId(
  resourceId: string,
  threadId: string
): Promise<string | undefined> {
  const agent = mastra.getAgentById("agent");
  const runId = agent.getActiveThreadRunId({ resourceId, threadId });
  if (!runId) {
    return;
  }
  const { runs } = await agent.listSuspendedRuns({ resourceId, threadId });
  return runs.some((run) => run.runId === runId) ? undefined : runId;
}
