"use client";

import { ChevronDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Frames a web preview; callers supply and validate the iframe URL. */
export function WebPreview({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex size-full min-h-0 flex-col rounded-lg border bg-card",
        className
      )}
      {...props}
    />
  );
}

/** Groups the preview address and navigation controls. */
export function WebPreviewNavigation({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex shrink-0 items-center gap-1 border-b p-2", className)}
      {...props}
    />
  );
}

/** Gives icon-only preview controls a visible tooltip and accessible name. */
export function WebPreviewNavigationButton({
  tooltip,
  ...props
}: ComponentProps<typeof Button> & { tooltip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={tooltip}
            size="icon-lg"
            type="button"
            variant="ghost"
            {...props}
          />
        }
      />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

/** Displays the preview URL without allowing navigation to arbitrary origins. */
export function WebPreviewUrl({
  className,
  ...props
}: ComponentProps<typeof Input>) {
  return (
    <Input
      aria-label="Preview URL"
      className={cn("min-w-0 flex-1", className)}
      readOnly
      {...props}
    />
  );
}

/** Sandboxes preview documents with no script, origin, popup, or form permissions by default. */
export function WebPreviewBody({
  className,
  ...props
}: ComponentProps<"iframe">) {
  return (
    <iframe
      className={cn("min-h-0 w-full flex-1", className)}
      referrerPolicy="no-referrer"
      sandbox=""
      title="Preview"
      {...props}
    />
  );
}

export interface WebPreviewConsoleLog {
  id: string;
  level: "log" | "warn" | "error";
  message: string;
  timestamp: Date;
}

interface WebPreviewConsoleProps extends ComponentProps<typeof Collapsible> {
  logs?: WebPreviewConsoleLog[];
}

/** Shows preview console output in a collapsible drawer that starts closed. */
export function WebPreviewConsole({
  className,
  logs = [],
  ...props
}: WebPreviewConsoleProps) {
  return (
    <Collapsible className={cn("shrink-0 border-t", className)} {...props}>
      <CollapsibleTrigger
        className="group/console flex h-11 w-full items-center justify-between px-4 text-left font-medium text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        type="button"
      >
        Console
        <ChevronDownIcon
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform duration-200 ease-out group-aria-expanded/console:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="max-h-48 overflow-y-auto px-4 pb-4 text-sm">
        {logs.length === 0 ? (
          <p className="text-muted-foreground">No console output.</p>
        ) : (
          <ol className="flex flex-col gap-1">
            {logs.map((log) => (
              <li
                className={cn(
                  log.level === "error" && "text-destructive",
                  log.level === "warn" && "text-amber-600 dark:text-amber-400"
                )}
                key={log.id}
              >
                <span className="text-muted-foreground tabular-nums">
                  {log.timestamp.toLocaleTimeString()}
                </span>{" "}
                {log.message}
              </li>
            ))}
          </ol>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
