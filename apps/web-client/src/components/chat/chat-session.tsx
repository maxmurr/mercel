"use client";

import {
  Provider,
  useChat,
  useChatActions,
  useChatError,
} from "@ai-sdk-tools/store";
import { useCallback, useEffect } from "react";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatConversation } from "@/components/chat/chat-conversation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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

// Keep the full useChat subscription out of the layout and selector consumers.
function ChatConnection({ id }: { id: string }) {
  const { stop } = useChat({
    id,
    // Batch tokens to keep streamed code blocks below React's update-depth limit.
    throttle: 50,
    transport: chatTransport,
  });

  useEffect(
    () => () => {
      stop();
    },
    [stop]
  );

  return null;
}

function ChatError() {
  const error = useChatError();
  const { regenerate } = useChatActions();

  const handleRetry = useCallback(async () => {
    await regenerate();
  }, [regenerate]);

  if (error === undefined) {
    return null;
  }

  return (
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
  );
}

/** Owns one chat store and draft; key by session ID to reset and abort on unmount. */
export function ChatSession({ id }: { id: string }) {
  return (
    <Provider>
      <ChatConnection id={id} />
      <ChatConversation className="flex-1" />
      <ChatError />
      <ChatComposer />
    </Provider>
  );
}
