import { queryOptions } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import { format } from "date-fns";

const chatThreadApi = "/api/chat";

export interface ChatThread {
  /** A reply is still being generated; the chat reconnects to it instead of waiting. */
  isStreaming: boolean;
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

/**
 * Ends the reply a thread is generating.
 *
 * The run outlives the request that started it, so closing the stream in the
 * browser leaves the model writing; only this reaches it.
 */
export async function stopThreadRun(threadId: string): Promise<void> {
  const response = await fetch(
    `${chatThreadApi}/${encodeURIComponent(threadId)}/stream`,
    { method: "DELETE" }
  );
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
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

/** Row in the thread sidebar; the conversation itself loads from `threadOptions`. */
export interface ChatThreadSummary {
  /** Last deployment published from this thread, so its site stays reachable after a reload. */
  deploymentId?: string;
  id: string;
  /** Empty until Mastra's title generation lands, so the sidebar needs a fallback. */
  title: string;
  updatedAt: string;
}

/** Shared by the sidebar query and the chat that invalidates it after a turn. */
export const threadListKey = ["chat-threads"];

async function fetchThreadList(): Promise<ChatThreadSummary[]> {
  const response = await fetch(`${chatThreadApi}/threads`);
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  const { threads } = await response.json();
  return threads;
}

/** The signed-in account's conversations, newest first; empty while signed out. */
export function threadListOptions() {
  return queryOptions({
    queryFn: fetchThreadList,
    queryKey: threadListKey,
  });
}

/** Mastra stamps this name on a thread until its generated title lands. */
const placeholderTitlePattern = /^New Thread \d{4}-/;

/** Falls back to when the conversation was last touched, so threads stay distinguishable. */
export function threadLabel({ title, updatedAt }: ChatThreadSummary): string {
  const name = title.trim();
  if (name && !placeholderTitlePattern.test(name)) {
    return name;
  }
  return format(new Date(updatedAt), "d MMM, HH:mm");
}
