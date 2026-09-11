"use client";

import { useChat } from "@ai-sdk/react";
import { MessageSquareIcon, MonitorIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatConversation } from "@/components/chat/chat-conversation";
import { ChatHeader } from "@/components/chat/chat-header";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ChatPreview } from "@/components/chat/chat-preview";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Separator } from "@/components/ui/separator";
import { useIsMobile } from "@/hooks/use-mobile";
import { MastraChatTransport } from "@/lib/mastra-chat-transport";

const chatTransport = new MastraChatTransport({
  api: "/api/mastra/agents/agent/stream",
  prepareSendMessagesRequest: ({ id, messages }) => ({
    body: {
      messages,
      requestContext: { opencodeSessionId: id },
    },
  }),
});

// Keep script-enabled deployment previews on a separate origin from the web app.
const previewUrl = "http://yoopy.localhost:3001/";

/** Chats with the registered Mastra agent; conversation history lasts until reset or navigation. */
export default function ChatPage() {
  const [chatId, setChatId] = useState(() => crypto.randomUUID());
  const [input, setInput] = useState("");
  const [mobilePanel, setMobilePanel] = useState("chat");
  const { error, messages, regenerate, sendMessage, status, stop } = useChat({
    id: chatId,
    // Batch tokens to keep streamed code blocks below React's update-depth limit.
    throttle: 50,
    transport: chatTransport,
  });
  const isBusy = status === "submitted" || status === "streaming";
  const isMobileLayout = useIsMobile(1024);

  useEffect(
    () => () => {
      stop();
    },
    [stop]
  );

  async function handleSendMessage(content: string) {
    if (isBusy) {
      return;
    }
    setInput("");
    await sendMessage({ text: content });
  }

  async function handleNewChat() {
    await stop();
    setChatId(crypto.randomUUID());
    setInput("");
    setMobilePanel("chat");
  }

  async function handleRetry() {
    await regenerate();
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
            <ChatConversation
              className="flex-1"
              messages={messages}
              status={status}
            />
            {error !== undefined && (
              <Alert className="mx-4 w-auto sm:mx-5" variant="destructive">
                <AlertDescription>
                  Unable to generate a reply. Your messages are still here.
                </AlertDescription>
                <Button
                  className="min-h-11 justify-self-start"
                  onClick={handleRetry}
                  variant="outline"
                >
                  Retry
                </Button>
              </Alert>
            )}
            <ChatComposer
              describedBy="chat-notice"
              isBusy={isBusy}
              onSend={handleSendMessage}
              onStop={stop}
              onValueChange={setInput}
              value={input}
            />
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
