"use client";

import {
  MessageSquareIcon,
  MonitorIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
} from "lucide-react";
import { useCallback, useState } from "react";
import { type Layout, usePanelRef } from "react-resizable-panels";
import { WebPreviewNavigationButton } from "@/components/ai-elements/web-preview";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChatPanel } from "@/features/chat/components/chat-panel";
import { ChatSession } from "@/features/chat/components/chat-session";
import type { ChatThread } from "@/features/chat/types/chat-thread";
import { ChatCode } from "@/features/workspace/components/chat-code";
import { ChatPreview } from "@/features/workspace/components/chat-preview";
import { useSandboxStore } from "@/features/workspace/hooks/use-sandbox-store";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSearchParamState } from "@/hooks/use-search-param";

const chatResizablePanelId = "chat-resizable-panel";

export function ChatWorkspace({
  threadId,
  thread,
}: {
  threadId: string;
  thread: ChatThread;
}) {
  const [view, setView] = useSearchParamState("view", "preview");
  const [mobilePanel, setMobilePanel] = useState("chat");
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);
  const chatPanelRef = usePanelRef();
  const isMobileLayout = useIsMobile(1024);
  const preview = useSandboxStore((state) => state.preview);

  const handlePanelToggle = useCallback(() => {
    setMobilePanel((panel) => (panel === "chat" ? "preview" : "chat"));
  }, []);

  const handleViewChange = useCallback(
    (value: unknown) => {
      setView(String(value));
    },
    [setView]
  );

  const handleLayoutChanged = useCallback((layout: Layout) => {
    setIsChatCollapsed(layout[chatResizablePanelId] === 0);
  }, []);

  const handleChatCollapseToggle = useCallback(() => {
    const chatPanel = chatPanelRef.current;
    if (chatPanel?.isCollapsed()) {
      chatPanel.expand();
    } else {
      chatPanel?.collapse();
    }
  }, [chatPanelRef]);

  return (
    <>
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
            <ChatSession id={threadId} key={threadId} thread={thread} />
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
    </>
  );
}
