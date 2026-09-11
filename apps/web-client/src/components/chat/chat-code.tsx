"use client";

import {
  code as codeHighlighter,
  type HighlightOptions,
  type HighlightResult,
} from "@streamdown/code";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { ChevronRightIcon, FileIcon, PanelLeftOpenIcon } from "lucide-react";
import {
  type ComponentProps,
  type CSSProperties,
  Fragment,
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  WebPreviewConsole,
  WebPreviewNavigationButton,
} from "@/components/ai-elements/web-preview";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

// Matches the workspace id configured on the agent in src/mastra/agents/agent.ts.
const workspaceFilesApi = "/api/mastra/workspaces/sandbox/fs";
const rootPath = ".";
const fileTreeId = "workspace-file-tree";
const hiddenEntries = new Set(["node_modules", ".git"]);
// ponytail: highlight only up to this size; tokenizing a bundled 300 KB file stalls the tab for seconds.
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

interface WorkspaceEntry {
  name: string;
  size?: number;
  type: "directory" | "file";
}

async function fetchWorkspace<T>(
  endpoint: "list" | "read",
  path: string
): Promise<T> {
  const response = await fetch(
    `${workspaceFilesApi}/${endpoint}?path=${encodeURIComponent(path)}`
  );
  const data: T & { error?: string } = await response.json();
  if (!response.ok || data.error) {
    throw new Error(
      data.error ?? `Request failed with status ${response.status}`
    );
  }
  return data;
}

function compareEntries(a: WorkspaceEntry, b: WorkspaceEntry) {
  if (a.type !== b.type) {
    return a.type === "directory" ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}

function directoryOptions(path: string) {
  return queryOptions({
    queryFn: () => fetchWorkspace<{ entries: WorkspaceEntry[] }>("list", path),
    queryKey: ["workspace-directory", path],
    select: (data) =>
      data.entries
        .filter((entry) => !hiddenEntries.has(entry.name))
        .toSorted(compareEntries),
    // The agent keeps editing files, so refetch whenever a folder or the tab mounts.
    staleTime: 0,
  });
}

function fileOptions(path: string) {
  return queryOptions({
    queryFn: () => fetchWorkspace<{ content: string }>("read", path),
    queryKey: ["workspace-file", path],
    select: (data) => data.content,
    staleTime: 0,
  });
}

function childPath(parentPath: string, name: string) {
  return parentPath === rootPath ? name : `${parentPath}/${name}`;
}

function languageForPath(path: string) {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return extensionLanguages.get(extension);
}

function indentStyle(depth: number) {
  return {
    "--tree-indent": `calc(var(--spacing) * ${3 + depth * 3})`,
  } as CSSProperties;
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

function StatusMessage({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "flex items-center gap-2 text-base/7 text-muted-foreground sm:text-sm/6",
        className
      )}
      {...props}
    />
  );
}

function LoadingMessage(props: ComponentProps<typeof StatusMessage>) {
  return (
    <StatusMessage role="status" {...props}>
      <Spinner
        aria-hidden="true"
        className="shrink-0 motion-reduce:animate-none"
        role="presentation"
      />
      Loading…
    </StatusMessage>
  );
}

const treeRowClass =
  "flex w-full min-w-0 items-center gap-2 py-2 pr-3 pl-(--tree-indent) text-left text-base/7 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:py-1 sm:text-sm/6";
const treeMessageClass = "py-2 pr-3 pl-(--tree-indent) sm:py-1";

interface TreeNodeProps {
  depth: number;
  entry: WorkspaceEntry;
  onSelect: (path: string) => void;
  parentPath: string;
  selectedPath: string | undefined;
}

function FileNode({
  depth,
  entry,
  onSelect,
  parentPath,
  selectedPath,
}: TreeNodeProps) {
  const path = childPath(parentPath, entry.name);
  const isSelected = path === selectedPath;

  const handleSelect = useCallback(() => {
    onSelect(path);
  }, [onSelect, path]);

  return (
    <li>
      <button
        aria-current={isSelected}
        className={cn(
          treeRowClass,
          isSelected && "bg-accent text-accent-foreground"
        )}
        onClick={handleSelect}
        style={indentStyle(depth)}
        type="button"
      >
        <FileIcon aria-hidden="true" className="size-4 shrink-0" />
        <span className="truncate">{entry.name}</span>
      </button>
    </li>
  );
}

function DirectoryNode({
  depth,
  entry,
  onSelect,
  parentPath,
  selectedPath,
}: TreeNodeProps) {
  const path = childPath(parentPath, entry.name);
  const [isOpen, setIsOpen] = useState(false);

  const handleToggle = useCallback(() => {
    setIsOpen((open) => !open);
  }, []);

  return (
    <li>
      <button
        aria-expanded={isOpen}
        className={treeRowClass}
        onClick={handleToggle}
        style={indentStyle(depth)}
        type="button"
      >
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 transition-transform motion-reduce:transition-none",
            isOpen && "rotate-90"
          )}
        />
        <span className="truncate">{entry.name}</span>
      </button>
      {isOpen ? (
        <DirectoryEntries
          depth={depth + 1}
          onSelect={onSelect}
          path={path}
          selectedPath={selectedPath}
        />
      ) : null}
    </li>
  );
}

interface DirectoryEntriesProps {
  depth: number;
  onSelect: (path: string) => void;
  path: string;
  selectedPath: string | undefined;
}

/** Lists one folder; nested folders fetch their own entries when expanded. */
function DirectoryEntries({
  depth,
  onSelect,
  path,
  selectedPath,
}: DirectoryEntriesProps) {
  const directoryQuery = useQuery(directoryOptions(path));

  if (directoryQuery.isPending) {
    return (
      <LoadingMessage className={treeMessageClass} style={indentStyle(depth)} />
    );
  }
  if (directoryQuery.isError) {
    return (
      <StatusMessage
        className={treeMessageClass}
        role="alert"
        style={indentStyle(depth)}
      >
        {directoryQuery.error.message}
      </StatusMessage>
    );
  }
  if (directoryQuery.data.length === 0) {
    return (
      <StatusMessage className={treeMessageClass} style={indentStyle(depth)}>
        Empty folder
      </StatusMessage>
    );
  }

  return (
    <ul>
      {directoryQuery.data.map((entry) => {
        const Node = entry.type === "directory" ? DirectoryNode : FileNode;
        return (
          <Node
            depth={depth}
            entry={entry}
            key={entry.name}
            onSelect={onSelect}
            parentPath={path}
            selectedPath={selectedPath}
          />
        );
      })}
    </ul>
  );
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
  // ponytail: every line is in the DOM; virtualize if multi-thousand-line files show up.
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

function FileBody({ path }: { path: string }) {
  const fileQuery = useQuery(fileOptions(path));

  if (fileQuery.isPending) {
    return <LoadingMessage className="p-4" />;
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

interface FileHeaderProps {
  onShowTree: () => void;
  path: string;
}

/** Shows the file path as a breadcrumb; the tree toggle only appears in narrow containers. */
function FileHeader({ onShowTree, path }: FileHeaderProps) {
  const segments = path.split("/");

  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2 sm:h-10">
      <WebPreviewNavigationButton
        aria-controls={fileTreeId}
        className="@lg:hidden size-11 sm:size-9"
        onClick={onShowTree}
        size="icon"
        tooltip="Show files"
      >
        <PanelLeftOpenIcon />
      </WebPreviewNavigationButton>
      <Breadcrumb className="min-w-0 flex-1 px-2">
        <BreadcrumbList className="flex-nowrap text-base sm:text-sm">
          {segments.map((segment, index) => {
            const segmentPath = segments.slice(0, index + 1).join("/");
            if (index === segments.length - 1) {
              return (
                <BreadcrumbItem className="min-w-0" key={segmentPath}>
                  <FileIcon aria-hidden="true" className="size-4 shrink-0" />
                  <BreadcrumbPage className="truncate">
                    {segment}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              );
            }
            return (
              <Fragment key={segmentPath}>
                <BreadcrumbItem className="shrink-0">{segment}</BreadcrumbItem>
                <BreadcrumbSeparator />
              </Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
}

/** Browses the agent's sandbox: a lazily loaded file tree beside a read-only, highlighted viewer. */
export function ChatCode({ className }: { className?: string }) {
  const [selectedPath, setSelectedPath] = useState<string>();
  // Narrow containers show either the tree or the file; wide ones show both.
  const [isTreeOpen, setIsTreeOpen] = useState(true);

  const handleSelect = useCallback((path: string) => {
    setSelectedPath(path);
    setIsTreeOpen(false);
  }, []);

  const handleShowTree = useCallback(() => {
    setIsTreeOpen(true);
  }, []);

  return (
    <div className={cn("flex h-full min-h-0 min-w-0 flex-col", className)}>
      <div className="@container flex min-h-0 min-w-0 flex-1">
        <nav
          aria-label="Workspace files"
          className={cn(
            "flex min-h-0 @lg:w-56 w-full shrink-0 flex-col @lg:border-r",
            !isTreeOpen && "@max-lg:hidden"
          )}
          id={fileTreeId}
        >
          <h2 className="flex h-12 shrink-0 items-center border-b px-4 font-medium text-base sm:h-10 sm:text-sm">
            Files
          </h2>
          <div className="scrollbar-subtle min-h-0 flex-1 overflow-auto py-1">
            <DirectoryEntries
              depth={0}
              onSelect={handleSelect}
              path={rootPath}
              selectedPath={selectedPath}
            />
          </div>
        </nav>
        <section
          aria-label="File contents"
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col",
            isTreeOpen && "@max-lg:hidden"
          )}
        >
          {selectedPath === undefined ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileIcon />
                </EmptyMedia>
                <EmptyTitle>No file selected</EmptyTitle>
                <EmptyDescription>
                  Pick a file from the tree to read it.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <FileHeader onShowTree={handleShowTree} path={selectedPath} />
              <FileBody path={selectedPath} />
            </>
          )}
        </section>
      </div>
      <WebPreviewConsole />
    </div>
  );
}
