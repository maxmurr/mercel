import { queryOptions } from "@tanstack/react-query";
import type { UIMessage } from "ai";

const chatThreadApi = "/api/chat";

export interface ChatThread {
  messages: UIMessage[];
  /** Owner Mastra stores the thread under; the chat must send it back to append to it. */
  resourceId: string;
}

async function fetchThread(threadId: string): Promise<ChatThread> {
  const response = await fetch(
    `${chatThreadApi}/${encodeURIComponent(threadId)}/messages`
  );
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return response.json();
}

/** Stored conversation for a thread; empty until its first message is saved. */
export function threadOptions(threadId: string) {
  return queryOptions({
    queryFn: () => fetchThread(threadId),
    queryKey: ["chat-thread", threadId],
    // The chat store owns the conversation once it is loaded; refetching would fight it.
    staleTime: Number.POSITIVE_INFINITY,
  });
}
