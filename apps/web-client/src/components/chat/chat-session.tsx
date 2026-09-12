"use client";

import {
  Provider,
  useChat,
  useChatActions,
  useChatError,
  useChatStore,
} from "@ai-sdk-tools/store";
import { lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import { type ReactNode, useCallback, useEffect } from "react";
import { ChatComposer } from "@/components/chat/chat-composer";
import {
  ChatConversation,
  ToolApprovalContext,
} from "@/components/chat/chat-conversation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  MastraChatTransport,
  toolApprovalRequest,
} from "@/lib/mastra-chat-transport";
import { takePendingPrompt } from "@/lib/pending-prompt";
import { handleSandboxData } from "@/lib/sandbox-store";

const agentApi = "/api/mastra/agents/agent";

const chatTransport = new MastraChatTransport({
  api: `${agentApi}/stream`,
  prepareSendMessagesRequest: ({ id, messages }) => {
    const requestContext = { opencodeSessionId: id };
    // An answered approval resumes the suspended run instead of starting a new turn.
    const approval = toolApprovalRequest(messages);
    if (approval) {
      return {
        api: `${agentApi}/${approval.route}`,
        body: { ...approval.body, requestContext },
      };
    }
    return { body: { messages, requestContext } };
  },
});

// Keep the full useChat subscription out of the layout and selector consumers.
function ChatConnection({ children, id }: { children: ReactNode; id: string }) {
  const { addToolApprovalResponse, stop } = useChat({
    id,
    onData: handleSandboxData,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
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

  return (
    <ToolApprovalContext value={addToolApprovalResponse}>
      {children}
    </ToolApprovalContext>
  );
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
      <ChatConnection id={id}>
        <ChatLaunchPrompt id={id} />
        <ChatConversation className="flex-1" />
        <ChatError />
        <ChatComposer />
      </ChatConnection>
    </Provider>
  );
}
