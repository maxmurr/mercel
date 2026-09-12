"use client";

import {
  code as codeHighlighter,
  type HighlightOptions,
  type HighlightResult,
} from "@streamdown/code";
import { useQuery } from "@tanstack/react-query";
import { type CSSProperties, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { fileOptions } from "@/features/workspace/workspace-query-options";
import { cn } from "@/lib/utils";

const highlightLimit = 100_000;

type Language = HighlightOptions["language"];
type TokenLines = HighlightResult["tokens"];

const extensionLanguages = new Map<string, Language>([
  ["cjs", "javascript"],
  ["css", "css"],
  ["html", "html"],
  ["js", "javascript"],
  ["json", "json"],
  ["jsx", "jsx"],
  ["md", "markdown"],
  ["mjs", "javascript"],
  ["sh", "shellscript"],
  ["svg", "xml"],
  ["toml", "toml"],
  ["ts", "typescript"],
  ["tsx", "tsx"],
  ["xml", "xml"],
  ["yaml", "yaml"],
  ["yml", "yaml"],
]);

function languageForPath(path: string) {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return extensionLanguages.get(extension);
}

/** Resolves shiki tokens for the current source; returns nothing for plain or oversized files. */
function useHighlightedLines(code: string, language: Language | undefined) {
  const [highlighted, setHighlighted] = useState<{
    code: string;
    tokens: TokenLines;
  }>();

  useEffect(() => {
    if (!language || code.length > highlightLimit) {
      return;
    }
    let isCurrent = true;
    const apply = (result: HighlightResult) => {
      if (isCurrent) {
        setHighlighted({ code, tokens: result.tokens });
      }
    };
    const cached = codeHighlighter.highlight(
      { code, language, themes: codeHighlighter.getThemes() },
      apply
    );
    if (cached) {
      apply(cached);
    }
    return () => {
      isCurrent = false;
    };
  }, [code, language]);

  return highlighted?.code === code ? highlighted.tokens : undefined;
}

// An inline `color` would beat the dark variant, so expose both theme colors as variables.
function tokenStyle(token: TokenLines[number][number]) {
  return {
    "--shiki-dark": token.htmlStyle?.["--shiki-dark"],
    "--shiki-light": token.htmlStyle?.color,
  } as CSSProperties;
}

const codeLineClass =
  "block before:mr-6 before:inline-block before:w-(--line-gutter) before:select-none before:text-right before:text-muted-foreground/60 before:tabular-nums before:content-[counter(line)] before:[counter-increment:line]";

interface CodeViewerProps {
  code: string;
  language: Language | undefined;
}

/** Renders numbered source lines; token colors follow the light/dark theme pair. */
function CodeViewer({ code, language }: CodeViewerProps) {
  const source = code.endsWith("\n") ? code.slice(0, -1) : code;
  const tokenLines = useHighlightedLines(source, language);
  const lines: TokenLines =
    tokenLines ??
    source.split("\n").map((line) => [{ content: line, offset: 0 }]);
  const gutterStyle = {
    "--line-gutter": `${String(lines.length).length}ch`,
  } as CSSProperties;

  return (
    <div className="scrollbar-subtle min-h-0 flex-1 overflow-auto">
      <pre
        className="p-4 font-mono text-base/7 [counter-reset:line] sm:text-sm/6"
        style={gutterStyle}
      >
        <code>
          {lines.map((tokens, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity and the whole list re-renders when the file changes.
            <span className={codeLineClass} key={index}>
              {tokens.map((token) => (
                <span
                  className="text-(--shiki-light) dark:text-(--shiki-dark)"
                  key={token.offset}
                  style={tokenStyle(token)}
                >
                  {token.content}
                </span>
              ))}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

/** Downloads one workspace file and shows it highlighted for its extension. */
export function FileBody({
  path,
  threadId,
}: {
  path: string;
  threadId: string;
}) {
  const fileQuery = useQuery(fileOptions(threadId, path));

  if (fileQuery.isPending) {
    return <FileBodySkeleton />;
  }
  if (fileQuery.isError) {
    return (
      <Alert className="m-4 w-auto" variant="destructive">
        <AlertDescription>{fileQuery.error.message}</AlertDescription>
      </Alert>
    );
  }

  return <CodeViewer code={fileQuery.data} language={languageForPath(path)} />;
}

const codeSkeletonWidths = [
  "w-2/3",
  "w-1/2",
  "w-3/4",
  "w-1/3",
  "w-5/6",
  "w-2/5",
];

export function FileBodySkeleton() {
  return (
    <div className="p-4" role="status">
      <span className="sr-only">Loading…</span>
      {codeSkeletonWidths.map((width) => (
        <div className="flex h-7 items-center sm:h-6" key={width}>
          <Skeleton className={cn("h-4 motion-reduce:animate-none", width)} />
        </div>
      ))}
    </div>
  );
}
