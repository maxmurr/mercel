"use client";

import { useQuery } from "@tanstack/react-query";
import { DownloadIcon } from "lucide-react";
import { PublishButton } from "@/components/chat/publish-button";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { UserMenu } from "@/components/user-menu";
import { threadLabel, threadListOptions } from "@/lib/chat-thread";
import { cn } from "@/lib/utils";

interface ChatHeaderProps {
  className?: string;
  threadId: string;
}

/** Names the open conversation and carries its workspace actions; the sidebar owns switching chats. */
export function ChatHeader({ className, threadId }: ChatHeaderProps) {
  // The sidebar shares this query, so the title costs no extra request.
  const { data: threads } = useQuery(threadListOptions());
  const thread = threads?.find((entry) => entry.id === threadId);

  return (
    <header
      className={cn(
        "flex min-h-16 shrink-0 items-center justify-between gap-3 px-4 sm:px-6",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <SidebarTrigger aria-label="Toggle Chats" className="size-11" />
        <Separator className="h-6" orientation="vertical" />
        {/* The agent retitles the thread mid-conversation, so announce the new name. */}
        <h1 aria-live="polite" className="truncate font-medium text-sm">
          {thread ? threadLabel(thread) : "New Chat"}
        </h1>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {/* The route answers with the zip itself, so a plain download link is the whole feature. */}
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
        <PublishButton threadId={threadId} />
        <UserMenu />
      </div>
    </header>
  );
}
