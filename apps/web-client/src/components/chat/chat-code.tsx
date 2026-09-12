"use client";

import {
  code as codeHighlighter,
  type HighlightOptions,
  type HighlightResult,
} from "@streamdown/code";
import { queryOptions, useQuery } from "@tanstack/react-query";
import {
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  PanelLeftOpenIcon,
} from "lucide-react";
import {
  type ComponentProps,
  type CSSProperties,
  Fragment,
  useCallback,
  useEffect,
  useState,
} from "react";
import { WebPreviewNavigationButton } from "@/components/ai-elements/web-preview";
import { SandboxConsole } from "@/components/chat/sandbox-console";
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
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Matches the workspace id configured on the agent in src/mastra/agents/agent.ts.
const workspaceFilesApi = "/api/mastra/workspaces/sandbox/fs";
const rootPath = ".";
const fileTreeId = "workspace-file-tree";
const hiddenEntries = new Set(["node_modules", ".git"]);
const highlightLimit = 100_000;
// The agent keeps editing files, so folders and the open file refresh while the tab is visible.
const liveRefreshMs = 2000;

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
    refetchInterval: liveRefreshMs,
    select: (data) =>
      data.entries
        .filter((entry) => !hiddenEntries.has(entry.name))
        .toSorted(compareEntries),
    staleTime: 0,
  });
}

function fileOptions(path: string) {
  return queryOptions({
    queryFn: () => fetchWorkspace<{ content: string }>("read", path),
    queryKey: ["workspace-file", path],
    refetchInterval: liveRefreshMs,
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

// Fixed widths keep server and client markup identical instead of reshuffling on every render.
const treeSkeletonWidths = ["w-28", "w-20", "w-32", "w-24", "w-16"];
const codeSkeletonWidths = [
  "w-2/3",
  "w-1/2",
  "w-3/4",
  "w-1/3",
  "w-5/6",
  "w-2/5",
];

interface TreeSkeletonProps {
  depth: number;
  rows?: number;
}

/** Placeholder rows sized like tree rows so entries slot in without moving anything. */
function TreeSkeleton({
  depth,
  rows = treeSkeletonWidths.length,
}: TreeSkeletonProps) {
  return (
    <div role="status">
      <span className="sr-only">Loading…</span>
      {treeSkeletonWidths.slice(0, rows).map((width) => (
        <div
          className="flex h-11 items-center gap-2 pr-3 pl-(--tree-indent) sm:h-8"
          key={width}
          style={indentStyle(depth)}
        >
          <Skeleton className="size-4 shrink-0 motion-reduce:animate-none" />
          <Skeleton className={cn("h-4 motion-reduce:animate-none", width)} />
        </div>
      ))}
    </div>
  );
}

/** Placeholder lines sized like code lines while a file downloads. */
function CodeSkeleton() {
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

interface EntryListProps {
  depth: number;
  entries: WorkspaceEntry[];
  onSelect: (path: string) => void;
  path: string;
  selectedPath: string | undefined;
}

function EntryList({
  depth,
  entries,
  onSelect,
  path,
  selectedPath,
}: EntryListProps) {
  return (
    <ul>
      {entries.map((entry) => {
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

type DirectoryEntriesProps = Omit<EntryListProps, "entries">;

/** Lists one nested folder; it fetches its own entries when expanded. */
function DirectoryEntries({
  depth,
  onSelect,
  path,
  selectedPath,
}: DirectoryEntriesProps) {
  const directoryQuery = useQuery(directoryOptions(path));

  if (directoryQuery.isPending) {
    return <TreeSkeleton depth={depth} rows={2} />;
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
    <EntryList
      depth={depth}
      entries={directoryQuery.data}
      onSelect={onSelect}
      path={path}
      selectedPath={selectedPath}
    />
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
    return <CodeSkeleton />;
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

/** Fills the tab when there is nothing to browse: no sandbox yet, or a sandbox without files. */
function WorkspaceEmpty({ title }: { title: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>
          Ask the agent to build something and its files will show up here.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

interface FilePaneProps {
  onShowTree: () => void;
  selectedPath: string | undefined;
}

function FilePane({ onShowTree, selectedPath }: FilePaneProps) {
  if (selectedPath === undefined) {
    return (
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
    );
  }

  return (
    <>
      <FileHeader onShowTree={onShowTree} path={selectedPath} />
      <FileBody path={selectedPath} />
    </>
  );
}

/** Browses the agent's sandbox: a lazily loaded file tree beside a read-only, highlighted viewer. */
function WorkspaceBrowser() {
  const rootQuery = useQuery(directoryOptions(rootPath));
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

  // The sandbox directory appears once the agent first runs; until then the root lookup fails.
  if (rootQuery.isError) {
    return <WorkspaceEmpty title="No sandbox yet" />;
  }
  const entries = rootQuery.data;
  if (entries?.length === 0) {
    return <WorkspaceEmpty title="No files yet" />;
  }

  return (
    <>
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
          {entries ? (
            <EntryList
              depth={0}
              entries={entries}
              onSelect={handleSelect}
              path={rootPath}
              selectedPath={selectedPath}
            />
          ) : (
            <TreeSkeleton depth={0} />
          )}
        </div>
      </nav>
      <section
        aria-label="File contents"
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col",
          isTreeOpen && "@max-lg:hidden"
        )}
      >
        {entries ? (
          <FilePane onShowTree={handleShowTree} selectedPath={selectedPath} />
        ) : null}
      </section>
    </>
  );
}

export function ChatCode({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-full min-h-0 min-w-0 flex-col", className)}>
      <div className="@container flex min-h-0 min-w-0 flex-1">
        <WorkspaceBrowser />
      </div>
      <SandboxConsole />
    </div>
  );
}
