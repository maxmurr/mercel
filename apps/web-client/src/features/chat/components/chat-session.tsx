"use client";

import {
  Provider,
  useChat,
  useChatActions,
  useChatError,
  useChatStore,
} from "@ai-sdk-tools/store";
import { useQueryClient } from "@tanstack/react-query";
import { lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import { type ReactNode, useCallback, useEffect, useMemo } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { threadListKey } from "@/features/chat/chat-cache";
import { takePendingPrompt } from "@/features/chat/chat-pending-prompt";
import { createChatTransport } from "@/features/chat/chat-transport";
import { ChatComposer } from "@/features/chat/components/chat-composer";
import {
  ChatConversation,
  ToolApprovalContext,
} from "@/features/chat/components/chat-conversation";
import type { ChatThread } from "@/features/chat/types/chat-thread";
import {
  handleSandboxData,
  lastPreviewUrl,
  useSandboxStore,
} from "@/features/workspace/hooks/use-sandbox-store";

// Keep the full useChat subscription out of the layout and selector consumers.
function ChatConnection({
  children,
  id,
  thread,
}: {
  children: ReactNode;
  id: string;
  thread: ChatThread;
}) {
  const queryClient = useQueryClient();
  const transport = useMemo(
    () => createChatTransport(thread.resourceId),
    [thread.resourceId]
  );
  const { addToolApprovalResponse, stop } = useChat({
    id,
    messages: thread.messages,
    onData: handleSandboxData,
    // A first turn creates the thread and a later one retitles it, so the
    // sidebar needs to re-read the list once the reply lands.
    onFinish: () => {
      queryClient
        .invalidateQueries({ queryKey: threadListKey })
        .catch(() => undefined);
    },
    // A reply the server is still writing streams on, whichever tab left it running.
    resume: thread.isStreaming,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    // Batch tokens to keep streamed code blocks below React's update-depth limit.
    throttle: 50,
    transport,
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

export function ChatSession({
  id,
  thread,
}: {
  id: string;
  thread: ChatThread;
}) {
  const openPreview = useSandboxStore((state) => state.openPreview);
  const resetForThread = useSandboxStore((state) => state.resetForThread);

  useEffect(() => {
    resetForThread(id);
    const url = lastPreviewUrl(thread.messages);
    if (url) {
      openPreview(url);
    }
  }, [id, openPreview, resetForThread, thread]);

  return (
    <Provider>
      <ChatConnection id={id} thread={thread}>
        <ChatLaunchPrompt id={id} />
        <ChatConversation className="flex-1" />
        <ChatError />
        <ChatComposer />
      </ChatConnection>
    </Provider>
  );
}
