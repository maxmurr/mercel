"use client";

import {
  useChatStore,
  useMessageById,
  useMessageIds,
} from "@ai-sdk-tools/store";
import { isToolUIPart, type UIMessage } from "ai";
import { MessageSquareIcon } from "lucide-react";
import { Streamdown } from "streamdown";
import { Reasoning } from "@/components/ai-elements/reasoning";
import { ToolPart } from "@/components/ai-elements/tool";
import {
  isWebSearchPart,
  WebSearchPart,
} from "@/components/ai-elements/web-search";
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

const streamdownClassName =
  "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0";

function AssistantPart({
  isStreaming,
  part,
}: {
  isStreaming: boolean;
  part: UIMessage["parts"][number];
}) {
  if (isToolUIPart(part)) {
    return isWebSearchPart(part) ? (
      <WebSearchPart part={part} />
    ) : (
      <ToolPart part={part} />
    );
  }
  if (part.type !== "text" && part.type !== "reasoning") {
    return null;
  }
  if (!part.text) {
    return null;
  }
  const markdown = (
    <Streamdown
      className={streamdownClassName}
      isAnimating={isStreaming}
      mode={isStreaming ? "streaming" : "static"}
      skipHtml
    >
      {part.text}
    </Streamdown>
  );
  if (part.type === "reasoning") {
    return <Reasoning isStreaming={isStreaming}>{markdown}</Reasoning>;
  }
  return (
    <Bubble variant="ghost">
      <BubbleContent className="wrap-anywhere">{markdown}</BubbleContent>
    </Bubble>
  );
}

function hasVisibleContent(part: UIMessage["parts"][number]) {
  return (
    ((part.type === "text" || part.type === "reasoning") && part.text !== "") ||
    isToolUIPart(part)
  );
}

function ChatMessageItem({ messageId }: { messageId: string }) {
  const message = useMessageById(messageId);
  const isStreaming = useChatStore(
    (state) =>
      state.status === "streaming" && state.getLastMessageId() === messageId
  );
  const isUser = message.role === "user";

  if (!message.parts.some(hasVisibleContent)) {
    return null;
  }

  return (
    <MessageScrollerItem messageId={message.id} scrollAnchor={isUser}>
      <Message align={isUser ? "end" : "start"}>
        <MessageContent>
          {isUser ? (
            <Bubble variant="secondary">
              <BubbleContent className="wrap-anywhere">
                <p className="whitespace-pre-wrap">
                  {message.parts
                    .flatMap((part) =>
                      part.type === "text" ? [part.text] : []
                    )
                    .join("\n\n")}
                </p>
              </BubbleContent>
            </Bubble>
          ) : (
            message.parts.map((part, index) => (
              <AssistantPart
                isStreaming={isStreaming && index === message.parts.length - 1}
                key={isToolUIPart(part) ? part.toolCallId : index}
                part={part}
              />
            ))
          )}
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
          !lastMessage.parts.some(hasVisibleContent)))
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
