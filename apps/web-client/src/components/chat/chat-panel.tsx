import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Keeps chat workspace sections sized to their resizable panel. */
export function ChatPanel({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn("flex h-full min-h-0 min-w-0 flex-col", className)}
      {...props}
    />
  );
}
