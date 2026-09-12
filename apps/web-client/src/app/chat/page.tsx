import { ChatLauncher } from "@/components/chat/chat-launcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { UserMenu } from "@/components/user-menu";

/** Sign-in lands here; the first prompt opens a conversation at /chat/[threadId]. */
export default function ChatPage() {
  return (
    <main className="isolate flex min-h-dvh flex-col bg-background text-foreground antialiased">
      <div className="flex shrink-0 items-center justify-end gap-2 p-4 sm:px-6">
        <ThemeSwitcher />
        <UserMenu />
      </div>
      {/* The bottom padding cancels the controls row above, so the prompt sits on the viewport's centre line. */}
      <div className="flex flex-1 items-center justify-center px-4 pb-16 sm:px-6">
        <ChatLauncher />
      </div>
    </main>
  );
}
