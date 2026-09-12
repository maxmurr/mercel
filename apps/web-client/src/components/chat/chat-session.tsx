"use client";

import {
  Provider,
  useChat,
  useChatActions,
  useChatError,
  useChatStore,
} from "@ai-sdk-tools/store";
import { useCallback, useEffect } from "react";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatConversation } from "@/components/chat/chat-conversation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { MastraChatTransport } from "@/lib/mastra-chat-transport";
import { takePendingPrompt } from "@/lib/pending-prompt";
import { handleSandboxData } from "@/lib/sandbox-store";

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
    onData: handleSandboxData,
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

// Waits for the transport before claiming the prompt, so a slow mount can't drop it.
function ChatLaunchPrompt({ id }: { id: string }) {
  const sendMessage = useChatStore((state) => state.sendMessage);

  useEffect(() => {
    if (!sendMessage) {
      return;
    }
    const prompt = takePendingPrompt(id);
    if (!prompt) {
      return;
    }
    // The store records the failure; ChatError offers the retry.
    sendMessage({ text: prompt }).catch(() => undefined);
  }, [id, sendMessage]);

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
      <ChatLaunchPrompt id={id} />
      <ChatConversation className="flex-1" />
      <ChatError />
      <ChatComposer />
    </Provider>
  );
}
