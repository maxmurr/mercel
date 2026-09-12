import { queryOptions } from "@tanstack/react-query";
import { threadListKey } from "@/features/chat/chat-cache";
import type { ChatThreadSummary } from "@/features/chat/types/chat-thread";

const chatThreadApi = "/api/chat";

export async function stopThreadRun(threadId: string): Promise<void> {
  const response = await fetch(
    `${chatThreadApi}/${encodeURIComponent(threadId)}/stream`,
    { method: "DELETE" }
  );
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
}

async function fetchThreadList(): Promise<ChatThreadSummary[]> {
  const response = await fetch(`${chatThreadApi}/threads`);
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  const { threads } = await response.json();
  return threads;
}

export function threadListOptions() {
  return queryOptions({
    queryFn: fetchThreadList,
    queryKey: threadListKey,
  });
}

/** Mastra stamps this name on a thread until its generated title lands. */
const placeholderTitlePattern = /^New Thread \d{4}-/;

/** Falls back to a UTC timestamp so untitled chats hydrate identically in every browser timezone. */
export function threadLabel({ title, updatedAt }: ChatThreadSummary): string {
  const name = title.trim();
  if (name && !placeholderTitlePattern.test(name)) {
    return name;
  }
  return `${new Date(updatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
