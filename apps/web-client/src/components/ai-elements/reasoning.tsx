"use client";

import { BrainIcon, ChevronDownIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/** Folds model reasoning behind a disclosure: open while streaming, collapsed once done unless the reader toggles it. */
export function Reasoning({
  children,
  className,
  isStreaming = false,
}: {
  children: ReactNode;
  className?: string;
  isStreaming?: boolean;
}) {
  const [readerOpen, setReaderOpen] = useState<boolean>();

  return (
    <Collapsible
      className={cn("flex w-full min-w-0 flex-col", className)}
      onOpenChange={setReaderOpen}
      open={readerOpen ?? isStreaming}
    >
      <CollapsibleTrigger className="group/reasoning flex min-h-11 w-fit items-center gap-2 rounded-lg text-muted-foreground text-sm outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        {isStreaming ? (
          <Spinner
            aria-hidden="true"
            className="shrink-0 motion-reduce:animate-none"
            role="presentation"
          />
        ) : (
          <BrainIcon aria-hidden="true" className="size-4 shrink-0" />
        )}
        {isStreaming ? (
          <span className="shimmer forced-colors:shimmer-none">Reasoning…</span>
        ) : (
          "Reasoning"
        )}
        <ChevronDownIcon
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform group-aria-expanded/reasoning:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
        <Bubble variant="muted">
          <BubbleContent className="text-muted-foreground">
            {children}
          </BubbleContent>
        </Bubble>
      </CollapsibleContent>
    </Collapsible>
  );
}
