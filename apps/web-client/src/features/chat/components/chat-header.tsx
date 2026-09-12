import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { threadListKey } from "@/features/chat/chat-cache";
import { getChatThreads } from "@/features/chat/chat-queries";
import { ChatHeaderClient } from "@/features/chat/components/chat-header-client";
import { getQueryClient } from "@/lib/query-client";

export async function ChatHeader({ threadId }: { threadId: string }) {
  const threads = await getChatThreads(await headers());
  if (threads instanceof Response) {
    redirect("/sign-in");
  }
  const queryClient = getQueryClient();
  queryClient.setQueryData(threadListKey, threads);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ChatHeaderClient threadId={threadId} />
    </HydrationBoundary>
  );
}

export function ChatHeaderSkeleton() {
  return (
    <>
      <div className="min-w-0 flex-1">
        <Skeleton className="h-4 w-32 max-w-full" />
      </div>
      <Skeleton className="h-11 w-20" />
      <Skeleton className="h-11 w-24" />
    </>
  );
}
