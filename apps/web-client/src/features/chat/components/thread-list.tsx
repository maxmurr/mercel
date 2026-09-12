import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SidebarMenuSkeleton } from "@/components/ui/sidebar";
import { threadListKey } from "@/features/chat/chat-cache";
import { getChatThreads } from "@/features/chat/chat-queries";
import { ThreadListClient } from "@/features/chat/components/thread-list-client";
import { getQueryClient } from "@/lib/query-client";

export async function ThreadList({ threadId }: { threadId?: string }) {
  const threads = await getChatThreads(await headers());
  if (threads instanceof Response) {
    redirect("/sign-in");
  }
  const queryClient = getQueryClient();
  queryClient.setQueryData(threadListKey, threads);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ThreadListClient threadId={threadId} />
    </HydrationBoundary>
  );
}

export function ThreadListSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Loading chats…</span>
      {[0, 1, 2].map((row) => (
        <SidebarMenuSkeleton className="h-11 sm:h-8" key={row} />
      ))}
    </div>
  );
}
