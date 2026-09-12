"use client";

import { useQuery } from "@tanstack/react-query";
import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  threadLabel,
  threadListOptions,
} from "@/features/chat/chat-query-options";
import { PublishButton } from "@/features/workspace/components/publish-button";

export function ChatHeaderClient({ threadId }: { threadId: string }) {
  const { data: threads } = useQuery(threadListOptions());
  const thread = threads?.find((entry) => entry.id === threadId);

  return (
    <>
      <h1
        aria-live="polite"
        className="min-w-0 flex-1 truncate font-medium text-sm"
      >
        {thread ? threadLabel(thread) : "New Chat"}
      </h1>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          className="h-11"
          nativeButton={false}
          render={
            <a
              download
              href={`/api/workspace/${encodeURIComponent(threadId)}/export`}
            />
          }
          variant="outline"
        >
          <DownloadIcon data-icon="inline-start" />
          Export
        </Button>
        <PublishButton
          deploymentId={thread?.deploymentId}
          threadId={threadId}
        />
      </div>
    </>
  );
}
