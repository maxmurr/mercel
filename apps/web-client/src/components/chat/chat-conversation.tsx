"use client";

import type { ChatStatus, UIMessage } from "ai";
import { MessageSquareIcon } from "lucide-react";
import { Streamdown } from "streamdown";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Spinner } from "@/components/ui/spinner";

function ChatMessageItem({
  isStreaming,
  message,
}: {
  isStreaming: boolean;
  message: UIMessage;
}) {
  const isUser = message.role === "user";
  const content = message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n");

  if (!content) {
    return null;
  }

  return (
    <MessageScrollerItem messageId={message.id} scrollAnchor={isUser}>
      <Message align={isUser ? "end" : "start"}>
        <MessageContent>
          <Bubble variant={isUser ? "secondary" : "ghost"}>
            <BubbleContent className="wrap-anywhere">
              {isUser ? (
                <p className="whitespace-pre-wrap">{content}</p>
              ) : (
                <Streamdown
                  className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                  isAnimating={isStreaming}
                  mode={isStreaming ? "streaming" : "static"}
                  skipHtml
                >
                  {content}
                </Streamdown>
              )}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  );
}

/** Renders chat history with plain user text, assistant markdown, and automatic scrolling. */
export function ChatConversation({
  className,
  messages,
  status,
}: {
  className?: string;
  messages: readonly UIMessage[];
  status: ChatStatus;
}) {
  const lastMessage = messages.at(-1);
  const isWaitingForReply =
    status === "submitted" ||
    (status === "streaming" &&
      (lastMessage?.role !== "assistant" ||
        !lastMessage.parts.some((part) => part.type === "text" && part.text)));

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller className={className}>
        <MessageScrollerViewport
          aria-label="Conversation messages"
          className="scrollbar-subtle scroll-fade-y scroll-fade-8 motion-reduce:scroll-fade-none forced-colors:scroll-fade-none"
        >
          <MessageScrollerContent
            aria-label="Conversation"
            className="gap-8 px-5 py-8 sm:px-8"
          >
            {messages.length === 0 ? (
              <MessageScrollerItem messageId="empty">
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <MessageSquareIcon />
                    </EmptyMedia>
                    <EmptyTitle>What can we build together?</EmptyTitle>
                    <EmptyDescription>
                      Ask a question or describe what you'd like to build.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </MessageScrollerItem>
            ) : (
              messages.map((message) => (
                <ChatMessageItem
                  isStreaming={
                    status === "streaming" && message.id === messages.at(-1)?.id
                  }
                  key={message.id}
                  message={message}
                />
              ))
            )}
            {isWaitingForReply ? (
              <MessageScrollerItem messageId="chat-pending">
                <p
                  className="flex items-center gap-2 text-muted-foreground text-sm"
                  role="status"
                >
                  <Spinner
                    aria-hidden="true"
                    className="shrink-0 motion-reduce:animate-none"
                    role="presentation"
                  />
                  <span className="shimmer forced-colors:shimmer-none">
                    Thinking…
                  </span>
                </p>
              </MessageScrollerItem>
            ) : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton
          aria-label="Scroll to latest message"
          behavior="instant"
          className="size-11 motion-reduce:transition-none"
        />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
