"use client";

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

/** Chat messages use stable IDs for scroll tracking and React keys. */
export interface ChatMessage {
  content: string;
  id: string;
  role: "user" | "assistant";
}

function ChatMessageItem({
  className,
  message,
}: {
  className?: string;
  message: ChatMessage;
}) {
  const isUser = message.role === "user";

  return (
    <MessageScrollerItem
      className={className}
      messageId={message.id}
      scrollAnchor={isUser}
    >
      <Message align={isUser ? "end" : "start"}>
        <MessageContent>
          <Bubble variant={isUser ? "secondary" : "ghost"}>
            <BubbleContent className="wrap-anywhere">
              {isUser ? (
                <p className="whitespace-pre-wrap">{message.content}</p>
              ) : (
                <Streamdown
                  className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                  mode="static"
                  skipHtml
                >
                  {message.content}
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
}: {
  className?: string;
  messages: readonly ChatMessage[];
}) {
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
                      Describe what you'd like to build. This demo shows the
                      chat UI without generating an app.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </MessageScrollerItem>
            ) : (
              messages.map((message) => (
                <ChatMessageItem key={message.id} message={message} />
              ))
            )}
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
