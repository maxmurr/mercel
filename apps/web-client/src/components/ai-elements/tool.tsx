"use client";

import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { getToolName } from "ai";
import {
  CheckIcon,
  ChevronDownIcon,
  HourglassIcon,
  ShieldXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { CodeBlock, CodeBlockCopyButton } from "streamdown";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type ToolPartValue = ToolUIPart | DynamicToolUIPart;

// No --warning token in this theme, so refusals borrow the console's warn color.
const warningClassName =
  "text-amber-600 hover:text-amber-600/80 dark:text-amber-400 dark:hover:text-amber-400/80";

const statusStyles = {
  denied: { className: warningClassName, icon: <ShieldXIcon /> },
  done: { className: "hover:text-foreground", icon: <CheckIcon /> },
  failed: {
    className: "text-destructive hover:text-destructive/80",
    icon: <TriangleAlertIcon />,
  },
  pending: { className: warningClassName, icon: <HourglassIcon /> },
  running: {
    className: "hover:text-foreground",
    icon: (
      <Spinner className="motion-reduce:animate-none" role="presentation" />
    ),
  },
} satisfies Record<string, { className: string; icon: ReactNode }>;

type Status = keyof typeof statusStyles;

function statusOf(part: ToolPartValue): Status {
  switch (part.state) {
    case "output-available":
      return "done";
    case "output-error":
      return "failed";
    case "output-denied":
      return "denied";
    case "approval-requested":
      return "pending";
    default:
      return "running";
  }
}

/** Picks what to print: the result once it came back, the error if it failed, otherwise what went in. */
function payloadOf(part: ToolPartValue) {
  if (part.state === "output-error") {
    return { code: part.errorText, language: "text" };
  }
  const value = part.state === "output-available" ? part.output : part.input;
  if (typeof value === "string") {
    return { code: value, language: "text" };
  }
  return {
    code: JSON.stringify(value ?? {}, null, 2) ?? String(value),
    language: "json",
  };
}

interface ToolPartProps {
  className?: string;
  /** Answers a pending approval; omit to render approval requests read-only. */
  onApprovalResponse?:
    | ((response: {
        approved: boolean;
        id: string;
      }) => void | PromiseLike<void>)
    | undefined;
  part: ToolPartValue;
}

/** Shows one tool call as a marker row; expanding prints its input or result as a copyable code block. */
export function ToolPart({
  className,
  onApprovalResponse,
  part,
}: ToolPartProps) {
  const [isOpen, setIsOpen] = useState(false);
  const status = statusOf(part);
  const { code, language } = payloadOf(part);
  const approvalId =
    part.state === "approval-requested" && onApprovalResponse
      ? part.approval.id
      : undefined;

  const handleDecline = useCallback(() => {
    if (approvalId) {
      onApprovalResponse?.({ approved: false, id: approvalId });
    }
  }, [approvalId, onApprovalResponse]);

  const handleApprove = useCallback(() => {
    if (approvalId) {
      onApprovalResponse?.({ approved: true, id: approvalId });
    }
  }, [approvalId, onApprovalResponse]);

  return (
    <Collapsible
      className={cn("flex w-full min-w-0 flex-col", className)}
      data-slot="tool-part"
      data-status={status}
      onOpenChange={setIsOpen}
      // Keep the arguments in view until the user decides; nobody should approve a call they can't read.
      open={isOpen || approvalId !== undefined}
    >
      <Marker
        className={cn(
          "min-h-11 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          statusStyles[status].className
        )}
        render={<CollapsibleTrigger />}
      >
        <MarkerIcon>{statusStyles[status].icon}</MarkerIcon>
        <MarkerContent
          className={cn(
            "flex-1 truncate",
            status === "running" && "shimmer forced-colors:shimmer-none"
          )}
        >
          {getToolName(part)}
        </MarkerContent>
        <MarkerIcon>
          <ChevronDownIcon className="transition-transform group-aria-expanded/marker:rotate-180 motion-reduce:transition-none" />
        </MarkerIcon>
      </Marker>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0 **:data-[streamdown=code-block]:my-0 motion-reduce:transition-none">
        <CodeBlock code={code} language={language} lineNumbers={false}>
          <CodeBlockCopyButton />
        </CodeBlock>
      </CollapsibleContent>
      {approvalId ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 pt-2"
          data-slot="tool-approval"
        >
          <p className="text-muted-foreground text-sm">
            Needs your approval before it runs.
          </p>
          <div className="flex gap-2">
            <Button
              className="min-h-11 sm:min-h-8"
              onClick={handleDecline}
              variant="ghost"
            >
              Decline
            </Button>
            <Button
              className="min-h-11 sm:min-h-8"
              onClick={handleApprove}
              variant="secondary"
            >
              Approve
            </Button>
          </div>
        </div>
      ) : null}
    </Collapsible>
  );
}
