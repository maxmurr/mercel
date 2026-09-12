import "server-only";

import { toAISdkMessages } from "@mastra/ai-sdk/ui";
import { isToolUIPart, type UIMessage } from "ai";
import { cache } from "react";
import { isQuestionnairePart } from "@/features/chat/chat-questionnaire";
import { threadAccess } from "@/features/chat/chat-thread-access";
import { resumableRunId } from "@/features/chat/chat-thread-run";
import type {
  ChatThread,
  ChatThreadSummary,
} from "@/features/chat/types/chat-thread";
import { getUserSession } from "@/features/user/user-queries";
import { mastra } from "@/mastra";
import { designBrief } from "@/mastra/processors/design-brief";

const threadsPerPage = 50;

export const getChatThreads = cache(
  async (requestHeaders: Headers): Promise<ChatThreadSummary[] | Response> => {
    const session = await getUserSession(requestHeaders);
    const resourceId = session?.user.id;
    if (!resourceId) {
      return Response.json({ error: "Sign in required" }, { status: 401 });
    }

    const memory = await mastra.getAgentById("agent").getMemory();
    if (!memory) {
      return [];
    }
    const { threads } = await memory.listThreads({
      filter: { resourceId },
      orderBy: { direction: "DESC", field: "updatedAt" },
      perPage: threadsPerPage,
    });
    return threads.map((thread) => {
      const deploymentId = thread.metadata?.deploymentId;
      return {
        deploymentId:
          typeof deploymentId === "string" ? deploymentId : undefined,
        id: thread.id,
        title: thread.title ?? "",
        updatedAt: thread.updatedAt.toISOString(),
      };
    });
  }
);

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

export async function getChatThread(
  threadId: string,
  requestHeaders: Headers
): Promise<ChatThread | Response> {
  const access = await threadAccess({ headers: requestHeaders }, threadId);
  if (access instanceof Response) {
    return access;
  }
  const [runId, memory] = await Promise.all([
    resumableRunId(access.userId, threadId),
    mastra.getAgentById("agent").getMemory(),
  ]);
  const isStreaming = Boolean(runId);
  if (!(memory && access.thread)) {
    return { isStreaming, messages: [], resourceId: access.userId };
  }
  const [{ messages }, { runs }] = await Promise.all([
    memory.recall({ perPage: false, threadId }),
    mastra
      .getAgentById("agent")
      .listSuspendedRuns({ resourceId: access.userId, threadId }),
  ]);
  const pendingQuestions = new Map(
    runs.flatMap((run) =>
      run.toolCalls
        .filter(
          (tool) => tool.toolName === "ask_user" && !tool.requiresApproval
        )
        .map(
          (tool) =>
            [
              tool.toolCallId,
              { input: tool.suspendPayload, runId: run.runId },
            ] as const
        )
    )
  );
  const uiMessages = toAISdkMessages(messages, { version: "v7" }).map(
    (message) => ({
      ...message,
      parts: message.parts.map((part) => {
        if (!(isToolUIPart(part) && isQuestionnairePart(part))) {
          return part;
        }
        const pending = pendingQuestions.get(part.toolCallId);
        return pending
          ? {
              approval: { id: `${pending.runId}::${part.toolCallId}` },
              input: pending.input ?? part.input,
              state: "approval-requested" as const,
              toolCallId: part.toolCallId,
              toolName: "ask_user",
              type: "dynamic-tool" as const,
            }
          : part;
      }),
    })
  );
  return {
    isStreaming,
    messages: withoutDesignBrief(uiMessages),
    resourceId: access.userId,
  };
}
