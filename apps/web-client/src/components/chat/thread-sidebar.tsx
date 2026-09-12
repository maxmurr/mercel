"use client";

import { useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { type ReactNode, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  useSidebar,
} from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import { threadLabel, threadListOptions } from "@/lib/chat-thread";

const skeletonRows = [0, 1, 2];

function ThreadNotice({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 py-1.5 text-base text-muted-foreground sm:text-sm">
      {children}
    </p>
  );
}

function ThreadSkeleton() {
  return (
    <div aria-label="Loading chats" role="status">
      {skeletonRows.map((row) => (
        <SidebarMenuSkeleton className="h-11 sm:h-8" key={row} />
      ))}
    </div>
  );
}

function ThreadList() {
  const { threadId } = useParams<{ threadId?: string }>();
  const { setOpenMobile } = useSidebar();
  const { data: session, isPending: isSessionPending } =
    authClient.useSession();
  const {
    data: threads,
    isError,
    isPending,
  } = useQuery({ ...threadListOptions(), enabled: Boolean(session) });

  const handleSelect = useCallback(() => {
    setOpenMobile(false);
  }, [setOpenMobile]);

  if (isSessionPending) {
    return <ThreadSkeleton />;
  }

  if (!session) {
    return <ThreadNotice>Sign in to keep your chats.</ThreadNotice>;
  }

  if (isError) {
    return <ThreadNotice>Could not load your chats.</ThreadNotice>;
  }

  if (isPending) {
    return <ThreadSkeleton />;
  }

  if (threads.length === 0) {
    return <ThreadNotice>No chats yet.</ThreadNotice>;
  }

  return (
    <SidebarMenu>
      {threads.map((thread) => (
        <SidebarMenuItem key={thread.id}>
          <SidebarMenuButton
            // Weight stays put between states so the open row does not reflow its neighbours.
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
  );
}

/** Lists the account's conversations; slides over the page on desktop, a sheet on mobile. */
export function ThreadSidebar() {
  return (
    <Sidebar>
      <SidebarHeader>
        <Button
          className="h-11 justify-start sm:h-10"
          nativeButton={false}
          render={<Link href="/chat" />}
          variant="outline"
        >
          <PlusIcon data-icon="inline-start" />
          New chat
        </Button>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Chats</SidebarGroupLabel>
          <SidebarGroupContent>
            <ThreadList />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
