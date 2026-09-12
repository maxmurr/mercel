import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { getChatThread } from "@/features/chat/chat-queries";
import { ChatWorkspace } from "@/features/chat/components/chat-workspace";

export async function ChatThread({ threadId }: { threadId: string }) {
  const thread = await getChatThread(threadId, await headers());
  if (thread instanceof Response) {
    if (thread.status === 401) {
      redirect("/sign-in");
    }
    notFound();
  }
  return <ChatWorkspace key={threadId} thread={thread} threadId={threadId} />;
}

export function ChatThreadSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" role="status">
      <span className="sr-only">Loading conversation…</span>
      <div className="flex justify-end border-b px-4 py-2 sm:px-6 lg:hidden">
        <Skeleton className="h-11 w-36" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col justify-between p-4 sm:p-5 lg:w-2/5 lg:flex-none lg:border-r">
          <div className="flex flex-col gap-4">
            <Skeleton className="h-12 w-3/4 self-end" />
            <Skeleton className="h-24 w-4/5" />
          </div>
          <Skeleton className="h-40 w-full" />
        </div>
        <div className="hidden min-w-0 flex-1 flex-col lg:flex">
          <div className="flex h-11 items-center gap-2 border-b px-2">
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-7 w-16" />
          </div>
          <div className="flex flex-1 items-center justify-center">
            <Skeleton className="h-24 w-48" />
          </div>
        </div>
      </div>
    </div>
  );
}
