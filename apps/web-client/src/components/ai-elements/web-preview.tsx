"use client";

import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
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
