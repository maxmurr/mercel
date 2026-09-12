import { ChatLauncher } from "@/components/chat/chat-launcher";
import { ThreadSidebar } from "@/components/chat/thread-sidebar";
import { mainContentId } from "@/components/skip-link";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { UserMenu } from "@/components/user-menu";

/** Sign-in lands here; the first prompt opens a conversation at /chat/[threadId]. */
export default function ChatPage() {
  return (
    <SidebarProvider className="isolate min-h-dvh bg-background text-foreground antialiased">
      <ThreadSidebar />
      <SidebarInset
        className="inset-safe min-h-dvh"
        id={mainContentId}
        tabIndex={-1}
      >
        <div className="flex shrink-0 items-center gap-2 p-4 sm:px-6">
          <SidebarTrigger aria-label="Toggle Chats" className="size-11" />
          <div className="flex flex-1 items-center justify-end gap-2">
            <UserMenu />
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
