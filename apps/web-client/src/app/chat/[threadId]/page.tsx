import { Suspense } from "react";
import { SectionErrorBoundary } from "@/components/section-error-boundary";
import { mainContentId } from "@/components/skip-link";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  ChatHeader,
  ChatHeaderSkeleton,
} from "@/features/chat/components/chat-header";
import {
  ChatThread,
  ChatThreadSkeleton,
} from "@/features/chat/components/chat-thread";
import {
  ThreadList,
  ThreadListSkeleton,
} from "@/features/chat/components/thread-list";
import { ThreadSidebar } from "@/features/chat/components/thread-sidebar";
import {
  UserMenu,
  UserMenuSkeleton,
} from "@/features/user/components/user-menu";

export default function ChatThreadPage({
  params,
}: PageProps<"/chat/[threadId]">) {
  return (
    <SidebarProvider
      className="isolate h-dvh min-h-0 overflow-hidden bg-background text-foreground antialiased"
      defaultOpen={false}
    >
      <ThreadSidebar>
        <SectionErrorBoundary title="Could not load your chats.">
          <Suspense fallback={<ThreadListSkeleton />}>
            {params.then(({ threadId }) => (
              <ThreadList threadId={threadId} />
            ))}
          </Suspense>
        </SectionErrorBoundary>
      </ThreadSidebar>
      <SidebarInset
        className="inset-safe min-h-0 overflow-hidden"
        data-testid="chat-thread-shell"
        id={mainContentId}
        tabIndex={-1}
      >
        <header className="flex min-h-16 shrink-0 items-center gap-3 px-4 sm:px-6">
          <SidebarTrigger aria-label="Toggle Chats" className="size-11" />
          <Separator className="h-6" orientation="vertical" />
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <SectionErrorBoundary title="Could not load conversation details.">
              <Suspense fallback={<ChatHeaderSkeleton />}>
                {params.then(({ threadId }) => (
                  <ChatHeader threadId={threadId} />
                ))}
              </Suspense>
            </SectionErrorBoundary>
          </div>
          <SectionErrorBoundary title="Could not load your account.">
            <Suspense fallback={<UserMenuSkeleton />}>
              <UserMenu />
            </Suspense>
          </SectionErrorBoundary>
        </header>
        <Separator />
        <div className="flex min-h-0 flex-1 flex-col">
          <SectionErrorBoundary title="Unable to load this conversation. Your messages are still stored.">
            <Suspense fallback={<ChatThreadSkeleton />}>
              {params.then(({ threadId }) => (
                <ChatThread threadId={threadId} />
              ))}
            </Suspense>
          </SectionErrorBoundary>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
