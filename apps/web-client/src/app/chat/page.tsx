"use client";

import {
  MessageSquareIcon,
  MonitorIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
} from "lucide-react";
import { useState } from "react";
import { type Layout, usePanelRef } from "react-resizable-panels";
import { WebPreviewNavigationButton } from "@/components/ai-elements/web-preview";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";

// Keep script-enabled deployment previews on a separate origin from the web app.
const previewUrl = "http://yoopy.localhost:3001/";
const chatResizablePanelId = "chat-resizable-panel";

/** Chats with the registered Mastra agent; conversation history lasts until reset or navigation. */
export default function ChatPage() {
  const [chatId, setChatId] = useState(() => crypto.randomUUID());
  const [mobilePanel, setMobilePanel] = useState("chat");
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);
  const chatPanelRef = usePanelRef();
  const isMobileLayout = useIsMobile(1024);

  function handleNewChat() {
    setChatId(crypto.randomUUID());
    setMobilePanel("chat");
  }

  function handlePanelToggle() {
    setMobilePanel((panel) => (panel === "chat" ? "preview" : "chat"));
  }

  function handleLayoutChanged(layout: Layout) {
    setIsChatCollapsed(layout[chatResizablePanelId] === 0);
  }

  function handleChatCollapseToggle() {
    const chatPanel = chatPanelRef.current;
    if (chatPanel?.isCollapsed()) {
      chatPanel.expand();
    } else {
      chatPanel?.collapse();
    }
  }

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground antialiased">
      <ChatHeader onNewChat={handleNewChat} title="Chat with Agent" />
      <Separator />
      <div className="flex shrink-0 items-center justify-end gap-3 px-4 py-2 sm:px-6 lg:hidden">
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
        className="max-lg:*:data-[mobile-hidden=true]:hidden! max-lg:*:grow! min-h-0 flex-1 has-data-[separator=active]:[&_iframe]:pointer-events-none"
        disabled={isMobileLayout}
        onLayoutChanged={handleLayoutChanged}
        orientation="horizontal"
      >
        <ResizablePanel
          collapsible
          data-mobile-hidden={mobilePanel !== "chat"}
          defaultSize="40%"
          id={chatResizablePanelId}
          maxSize="50%"
          minSize="25%"
          panelRef={chatPanelRef}
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
            <Tabs className="h-full min-h-0 gap-0" defaultValue="preview">
              <div className="flex shrink-0 items-center gap-1 border-b px-2">
                <WebPreviewNavigationButton
                  aria-controls="chat-panel"
                  className="max-lg:hidden"
                  onClick={handleChatCollapseToggle}
                  size="icon"
                  tooltip={isChatCollapsed ? "Show chat" : "Hide chat"}
                >
                  {isChatCollapsed ? (
                    <PanelLeftOpenIcon />
                  ) : (
                    <PanelLeftCloseIcon />
                  )}
                </WebPreviewNavigationButton>
                <TabsList aria-label="Preview views" variant="line">
                  <TabsTrigger value="preview">Preview</TabsTrigger>
                  <TabsTrigger value="code">Code</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent className="min-h-0" keepMounted value="preview">
                <ChatPreview
                  title="Agent skills example website"
                  url={previewUrl}
                />
              </TabsContent>
              <TabsContent className="min-h-0" value="code">
                <p className="px-4 py-3 text-base/7 text-muted-foreground sm:text-sm/6">
                  Nothing here yet.
                </p>
              </TabsContent>
            </Tabs>
          </ChatPanel>
        </ResizablePanel>
      </ResizablePanelGroup>
    </main>
  );
}
