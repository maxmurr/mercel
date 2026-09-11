"use client";

import { ArrowLeftIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ChatHeaderProps {
  className?: string;
  onNewChat: () => void;
  title: string;
}

/** Shows the chat title and delegates conversation reset to the page. */
export function ChatHeader({ className, onNewChat, title }: ChatHeaderProps) {
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
        <Button className="h-11" onClick={onNewChat} variant="outline">
          <PlusIcon data-icon="inline-start" />
          New chat
        </Button>
      </div>
    </header>
  );
}
