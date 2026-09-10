"use client";

import { MessageSquareIcon, MonitorIcon } from "lucide-react";
import { useState } from "react";
import { ChatComposer } from "@/components/chat/chat-composer";
import {
  ChatConversation,
  type ChatMessage,
} from "@/components/chat/chat-conversation";
import { ChatHeader } from "@/components/chat/chat-header";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ChatPreview } from "@/components/chat/chat-preview";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Separator } from "@/components/ui/separator";
import { useIsMobile } from "@/hooks/use-mobile";

const exampleMessages: ChatMessage[] = [
  {
    content: "Build me an agent skills website with a modern dark theme.",
    id: "example-user-1",
    role: "user",
  },
  {
    content:
      "Here's an example direction: a dark canvas, a short introduction, and a grid of skills. Each card explains what the skill does.",
    id: "example-assistant-1",
    role: "assistant",
  },
  {
    content: "Add a hero section and cards for different capabilities.",
    id: "example-user-2",
    role: "user",
  },
  {
    content:
      "The example preview includes:\n\n- A hero introducing **skills for your agents**\n- Cards for web search, code review, and other tasks\n- A layout that adapts to smaller screens\n\nThis is a static demo, not a generated app. Try the composer below to explore the conversation UI.",
    id: "example-assistant-2",
    role: "assistant",
  },
];

// Keep script-enabled deployment previews on a separate origin from the web app.
const previewUrl = "http://yoopy.localhost:3001/";

/** Demonstrates the chat workspace without sending prompts to an unconfigured AI backend. */
export default function ChatPage() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState(exampleMessages);
  const [mobilePanel, setMobilePanel] = useState("chat");
  const isMobileLayout = useIsMobile(1024);

  function handleSendMessage(content: string) {
    setMessages((history) => [
      ...history,
      { content, id: crypto.randomUUID(), role: "user" },
      {
        content:
          "App generation isn't connected in this demo. Your message stays in this conversation, and the example preview hasn't changed. To deploy an existing GitHub repository, use [New Project](/).",
        id: crypto.randomUUID(),
        role: "assistant",
      },
    ]);
    setInput("");
  }

  function handleNewChat() {
    setMessages([]);
    setInput("");
    setMobilePanel("chat");
  }

  function handlePanelToggle() {
    setMobilePanel((panel) => (panel === "chat" ? "preview" : "chat"));
  }

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground antialiased">
      <ChatHeader onNewChat={handleNewChat} title="Agent skills website" />
      <Separator />
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-2 sm:px-6">
        <p className="text-muted-foreground text-xs" id="chat-demo-notice">
          UI demo. No AI connected. Messages reset when you leave this page.
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
            <ChatConversation className="flex-1" messages={messages} />
            <ChatComposer
              describedBy="chat-demo-notice"
              onSend={handleSendMessage}
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
