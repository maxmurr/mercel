"use client";

import {
  useChatStore,
  useMessageById,
  useMessageIds,
} from "@ai-sdk-tools/store";
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

function ChatMessageItem({ messageId }: { messageId: string }) {
  const message = useMessageById(messageId);
  const isStreaming = useChatStore(
    (state) =>
      state.status === "streaming" && state.getLastMessageId() === messageId
  );
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

function ChatPendingReply() {
  const isWaitingForReply = useChatStore((state) => {
    const lastMessage = state.getThrottledMessages().at(-1);
    return (
      state.status === "submitted" ||
      (state.status === "streaming" &&
        (lastMessage?.role !== "assistant" ||
          !lastMessage.parts.some((part) => part.type === "text" && part.text)))
    );
  });

  if (!isWaitingForReply) {
    return null;
  }

  return (
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
        <span className="shimmer forced-colors:shimmer-none">Thinking…</span>
      </p>
    </MessageScrollerItem>
  );
}

/** Subscribes to chat message IDs; each row observes only its own content. */
export function ChatConversation({ className }: { className?: string }) {
  const messageIds = useMessageIds();

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
            {messageIds.length === 0 ? (
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
              messageIds.map((messageId) => (
                <ChatMessageItem key={messageId} messageId={messageId} />
              ))
            )}
            <ChatPendingReply />
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
