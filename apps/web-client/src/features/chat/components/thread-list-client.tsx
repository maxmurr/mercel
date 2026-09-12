"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  threadLabel,
  threadListOptions,
} from "@/features/chat/chat-query-options";

export function ThreadListClient({
  threadId,
}: {
  threadId?: string | undefined;
}) {
  const { setOpenMobile } = useSidebar();
  const { data: threads, isError, refetch } = useQuery(threadListOptions());

  const handleSelect = useCallback(() => {
    setOpenMobile(false);
  }, [setOpenMobile]);

  const handleRetry = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return (
    <>
      {isError ? (
        <div className="flex flex-col items-start gap-1">
          <p
            className="px-2 py-1.5 text-base text-muted-foreground sm:text-sm"
            role="alert"
          >
            Could not load your chats. Your conversations are safe. Try again.
          </p>
          <Button
            className="mx-2 h-11 sm:h-8"
            onClick={handleRetry}
            variant="outline"
          >
            Retry
          </Button>
        </div>
      ) : null}
      {threads?.length === 0 ? (
        <p className="px-2 py-1.5 text-base text-muted-foreground sm:text-sm">
          No chats yet.
        </p>
      ) : null}
      <SidebarMenu>
        {threads?.map((thread) => (
          <SidebarMenuItem key={thread.id}>
            <SidebarMenuButton
              className="h-11 text-base data-active:font-normal sm:h-8 sm:text-sm"
              isActive={thread.id === threadId}
              onClick={handleSelect}
              render={<Link href={`/chat/${thread.id}`} />}
            >
              <span>{threadLabel(thread)}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </>
  );
}
