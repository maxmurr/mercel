"use client";

import { ArrowLeftIcon, PlusIcon, UploadIcon } from "lucide-react";
import Link from "next/link";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/user-menu";
import { cn } from "@/lib/utils";

interface ChatHeaderProps {
  className?: string;
  title: string;
}

/** Shows the chat title; "New chat" returns to the launcher at /chat. */
export function ChatHeader({ className, title }: ChatHeaderProps) {
  return (
    <header
      className={cn(
        "flex min-h-16 shrink-0 items-center justify-between gap-3 px-4 sm:px-6",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Button
          aria-label="Back to New Project"
          className="size-11"
          nativeButton={false}
          render={<Link href="/" />}
          size="icon"
          variant="ghost"
        >
          <ArrowLeftIcon />
        </Button>
        <h1 className="truncate font-medium text-sm">{title}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ThemeSwitcher />
        <Button
          aria-label="New chat"
          className="h-10 max-sm:w-10"
          nativeButton={false}
          render={<Link href="/chat" />}
          variant="outline"
        >
          <PlusIcon data-icon="inline-start" />
          <span className="max-sm:hidden">New chat</span>
        </Button>
        <Button className="h-11" variant="default">
          <UploadIcon data-icon="inline-start" />
          Publish
        </Button>
        <UserMenu />
      </div>
    </header>
  );
}
