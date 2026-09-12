"use client";

import {
  MessageSquareIcon,
  MonitorIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { type Layout, usePanelRef } from "react-resizable-panels";
import { WebPreviewNavigationButton } from "@/components/ai-elements/web-preview";
import { ChatCode } from "@/components/chat/chat-code";
import { ChatHeader } from "@/components/chat/chat-header";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ChatPreview } from "@/components/chat/chat-preview";
import { ChatSession } from "@/components/chat/chat-session";
import { ThreadSidebar } from "@/components/chat/thread-sidebar";
import { mainContentId } from "@/components/skip-link";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSearchParamState } from "@/hooks/use-search-param";
import { useSandboxStore } from "@/lib/sandbox-store";

const chatResizablePanelId = "chat-resizable-panel";

/** Chats with the registered Mastra agent; the thread ID in the URL owns the conversation. */
export default function ChatThreadPage() {
  const { threadId } = useParams<{ threadId: string }>();
  // Which workspace tab is open travels in the URL so a reload or a shared link reopens it.
  const [view, setView] = useSearchParamState("view", "preview");
  // Whether the narrow layout shows chat or the workspace follows the viewport, not the link.
  const [mobilePanel, setMobilePanel] = useState("chat");
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);
  const chatPanelRef = usePanelRef();
  const isMobileLayout = useIsMobile(1024);
  const preview = useSandboxStore((state) => state.preview);

  function handlePanelToggle() {
    setMobilePanel((panel) => (panel === "chat" ? "preview" : "chat"));
  }

  function handleViewChange(value: unknown) {
    setView(String(value));
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
    // The workspace already splits chat and preview, so the sidebar starts out of the way.
    <SidebarProvider
      className="isolate h-dvh min-h-0 overflow-hidden bg-background text-foreground antialiased"
      defaultOpen={false}
    >
      <ThreadSidebar />
      <SidebarInset
        className="inset-safe min-h-0 overflow-hidden"
        id={mainContentId}
        tabIndex={-1}
      >
        <ChatHeader threadId={threadId} />
        <Separator />
        <div className="flex shrink-0 items-center justify-end gap-3 border-b px-4 py-2 sm:px-6 lg:hidden">
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
            {mobilePanel === "chat" ? "Show Preview" : "Show Chat"}
          </Button>
        </div>
        <ResizablePanelGroup
          className="max-lg:*:grow! max-lg:*:data-[mobile-hidden=true]:hidden! min-h-0 flex-1 has-data-[separator=active]:[&_iframe]:pointer-events-none"
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
              <ChatSession id={threadId} key={threadId} />
            </ChatPanel>
          </ResizablePanel>
          <ResizableHandle
            aria-label="Resize Chat and Preview"
            className="hidden lg:flex"
            withHandle
          />
          <ResizablePanel
            data-mobile-hidden={mobilePanel !== "preview"}
            defaultSize="60%"
            id="preview-resizable-panel"
            minSize="50%"
          >
            <ChatPanel aria-label="Workspace" id="preview-panel">
              <Tabs
                className="h-full min-h-0 gap-0"
                onValueChange={handleViewChange}
                value={view}
              >
                <div className="flex shrink-0 items-center gap-1 border-b px-2">
                  <WebPreviewNavigationButton
                    aria-controls="chat-panel"
                    aria-expanded={!isChatCollapsed}
                    className="max-lg:hidden"
                    onClick={handleChatCollapseToggle}
                    size="icon"
                    tooltip={isChatCollapsed ? "Show Chat" : "Hide Chat"}
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
                    key={preview?.revision}
                    threadId={threadId}
                    title="Agent preview"
                    url={preview?.url}
                  />
                </TabsContent>
                <TabsContent className="min-h-0" value="code">
                  <ChatCode threadId={threadId} />
                </TabsContent>
              </Tabs>
            </ChatPanel>
          </ResizablePanel>
        </ResizablePanelGroup>
      </SidebarInset>
    </SidebarProvider>
  );
}
