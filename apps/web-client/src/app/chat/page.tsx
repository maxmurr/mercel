import { Suspense } from "react";
import { SectionErrorBoundary } from "@/components/section-error-boundary";
import { mainContentId } from "@/components/skip-link";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ChatLauncher } from "@/features/chat/components/chat-launcher";
import {
  ThreadList,
  ThreadListSkeleton,
} from "@/features/chat/components/thread-list";
import { ThreadSidebar } from "@/features/chat/components/thread-sidebar";
import {
  UserMenu,
  UserMenuSkeleton,
} from "@/features/user/components/user-menu";

/** Sign-in lands here; the first prompt opens a conversation at /chat/[threadId]. */
export default function ChatPage() {
  return (
    <SidebarProvider className="isolate min-h-dvh bg-background text-foreground antialiased">
      <ThreadSidebar>
        <SectionErrorBoundary title="Could not load your chats.">
          <Suspense fallback={<ThreadListSkeleton />}>
            <ThreadList />
          </Suspense>
        </SectionErrorBoundary>
      </ThreadSidebar>
      <SidebarInset
        className="inset-safe min-h-dvh"
        data-testid="chat-shell"
        id={mainContentId}
        tabIndex={-1}
      >
        <div className="flex shrink-0 items-center gap-2 p-4 sm:px-6">
          <SidebarTrigger aria-label="Toggle Chats" className="size-11" />
          <div className="flex flex-1 items-center justify-end gap-2">
            <SectionErrorBoundary title="Could not load your account.">
              <Suspense fallback={<UserMenuSkeleton />}>
                <UserMenu />
              </Suspense>
            </SectionErrorBoundary>
          </div>
        </div>
        {/* The bottom padding cancels the controls row above, so the prompt sits on the viewport's centre line. */}
        <div className="flex flex-1 items-center justify-center px-4 pb-16 sm:px-6">
          <ChatLauncher />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
