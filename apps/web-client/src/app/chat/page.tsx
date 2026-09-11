"use client";

import { MessageSquareIcon, MonitorIcon } from "lucide-react";
import { useState } from "react";
import { ChatHeader } from "@/components/chat/chat-header";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ChatPreview } from "@/components/chat/chat-preview";
import { ChatSession } from "@/components/chat/chat-session";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Separator } from "@/components/ui/separator";
import { useIsMobile } from "@/hooks/use-mobile";

// Keep script-enabled deployment previews on a separate origin from the web app.
const previewUrl = "http://yoopy.localhost:3001/";

/** Chats with the registered Mastra agent; conversation history lasts until reset or navigation. */
export default function ChatPage() {
  const [chatId, setChatId] = useState(() => crypto.randomUUID());
  const [mobilePanel, setMobilePanel] = useState("chat");
  const isMobileLayout = useIsMobile(1024);

  function handleNewChat() {
    setChatId(crypto.randomUUID());
    setMobilePanel("chat");
  }

  function handlePanelToggle() {
    setMobilePanel((panel) => (panel === "chat" ? "preview" : "chat"));
  }

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground antialiased">
      <ChatHeader onNewChat={handleNewChat} title="Chat with Agent" />
      <Separator />
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-2 sm:px-6">
        <p className="text-muted-foreground text-xs" id="chat-notice">
          Messages reset when you leave this page. Preview is a static example.
        </p>
        <Button
          aria-controls={
            mobilePanel === "chat" ? "preview-panel" : "chat-panel"
          }
          className="h-11 lg:hidden"
          onClick={handlePanelToggle}
          variant="secondary"
        >
          {mobilePanel === "chat" ? (
            <MonitorIcon data-icon="inline-start" />
          ) : (
            <MessageSquareIcon data-icon="inline-start" />
          )}
          {mobilePanel === "chat" ? "Preview" : "Chat"}
        </Button>
      </div>
      <Separator />
      <ResizablePanelGroup
        className="max-lg:*:data-[mobile-hidden=true]:hidden! min-h-0 flex-1 has-data-[separator=active]:[&_iframe]:pointer-events-none"
        disabled={isMobileLayout}
        orientation="horizontal"
      >
        <ResizablePanel
          data-mobile-hidden={mobilePanel !== "chat"}
          defaultSize="40%"
          id="chat-resizable-panel"
          maxSize="50%"
          minSize="25%"
        >
          <ChatPanel aria-label="Chat" id="chat-panel">
            <ChatSession id={chatId} key={chatId} />
          </ChatPanel>
        </ResizablePanel>
        <ResizableHandle
          aria-label="Resize chat and preview"
          className="hidden lg:flex"
          withHandle
        />
        <ResizablePanel
          data-mobile-hidden={mobilePanel !== "preview"}
          defaultSize="60%"
          id="preview-resizable-panel"
          minSize="50%"
        >
          <ChatPanel aria-label="Example preview" id="preview-panel">
            <ChatPreview
              title="Agent skills example website"
              url={previewUrl}
            />
          </ChatPanel>
        </ResizablePanel>
      </ResizablePanelGroup>
    </main>
  );
}
