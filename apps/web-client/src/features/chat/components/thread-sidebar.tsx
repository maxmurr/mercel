import { PlusIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
} from "@/components/ui/sidebar";

export function ThreadSidebar({ children }: { children: ReactNode }) {
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
          New Chat
        </Button>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Chats</SidebarGroupLabel>
          <SidebarGroupContent>{children}</SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
