"use client";

import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { getToolName } from "ai";
import { GlobeIcon, TriangleAlertIcon } from "lucide-react";
import { z } from "zod";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type ToolPartValue = ToolUIPart | DynamicToolUIPart;

/** Mastra prefixes Exa's MCP tools with the server name. */
const webSearchToolName = "exa_web_search_exa";

// Streaming input arrives as partial JSON, so the query may be missing or half-typed.
const webSearchInputSchema = z.object({ query: z.string() });

export function isWebSearchPart(part: ToolPartValue) {
  return getToolName(part) === webSearchToolName;
}

/** Shows one Exa search as a status line: the query while it runs, a globe once done, a warning if it failed. */
export function WebSearchPart({
  className,
  part,
}: {
  className?: string;
  part: ToolPartValue;
}) {
  if (part.state === "output-error" || part.state === "output-denied") {
    return (
      <Marker
        className={cn("min-h-11 text-destructive", className)}
        data-status="failed"
      >
        <MarkerIcon>
          <TriangleAlertIcon />
        </MarkerIcon>
        <MarkerContent>Web search failed</MarkerContent>
      </Marker>
    );
  }
  const done = part.state === "output-available";
  const query = webSearchInputSchema.safeParse(part.input).data?.query;

  return (
    <Marker
      className={cn("min-h-11", className)}
      data-status={done ? "done" : "running"}
    >
      <MarkerIcon>
        {done ? (
          <GlobeIcon />
        ) : (
          <Spinner className="motion-reduce:animate-none" role="presentation" />
        )}
      </MarkerIcon>
      <MarkerContent
        className={cn(!done && "shimmer forced-colors:shimmer-none")}
      >
        {done ? "Searched" : "Searching"} the web
        {query ? ` for ${query}` : ""}
      </MarkerContent>
    </Marker>
  );
}
