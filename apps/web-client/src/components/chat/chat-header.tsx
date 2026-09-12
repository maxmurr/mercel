"use client";

import { useQuery } from "@tanstack/react-query";
import { UploadIcon } from "lucide-react";
import { ThemeSwitcher } from "@/components/theme-switcher";
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
        <SidebarTrigger aria-label="Toggle chats" className="size-11" />
        <Separator className="h-6" orientation="vertical" />
        <h1 className="truncate font-medium text-sm">
          {thread ? threadLabel(thread) : "New chat"}
        </h1>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ThemeSwitcher />
        <Button className="h-11" variant="default">
          <UploadIcon data-icon="inline-start" />
          Publish
        </Button>
        <UserMenu />
      </div>
    </header>
  );
}
