"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon, FileIcon } from "lucide-react";
import {
  type ComponentProps,
  type CSSProperties,
  useCallback,
  useId,
  useState,
} from "react";
import {
  childPath,
  directoryOptions,
  type WorkspaceEntry,
} from "@/components/chat/workspace-files";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function indentStyle(depth: number) {
  return {
    "--tree-indent": `calc(var(--spacing) * ${3 + depth * 3})`,
  } as CSSProperties;
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

interface TreeSkeletonProps {
  depth: number;
  rows?: number;
}

/** Placeholder rows sized like tree rows so entries slot in without moving anything. */
export function TreeSkeleton({
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

const treeRowClass =
  "flex w-full min-w-0 items-center gap-2 py-2 pr-3 pl-(--tree-indent) text-left text-base/7 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:py-1 sm:text-sm/6";
const treeMessageClass = "py-2 pr-3 pl-(--tree-indent) sm:py-1";

interface TreeNodeProps {
  depth: number;
  entry: WorkspaceEntry;
  onSelect: (path: string) => void;
  parentPath: string;
  selectedPath: string | undefined;
  threadId: string;
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
        aria-current={isSelected ? "true" : undefined}
        className={cn(
          treeRowClass,
          isSelected && "bg-accent text-accent-foreground"
        )}
        onClick={handleSelect}
        style={indentStyle(depth)}
        type="button"
      >
        <FileIcon aria-hidden="true" className="size-4 shrink-0" />
        <span className="truncate" translate="no">
          {entry.name}
        </span>
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
  threadId,
}: TreeNodeProps) {
  const path = childPath(parentPath, entry.name);
  const contentsId = useId();
  const [isOpen, setIsOpen] = useState(false);

  const handleToggle = useCallback(() => {
    setIsOpen((open) => !open);
  }, []);

  return (
    <li>
      <button
        aria-controls={contentsId}
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
        <span className="truncate" translate="no">
          {entry.name}
        </span>
      </button>
      <div id={contentsId}>
        {isOpen ? (
          <DirectoryEntries
            depth={depth + 1}
            onSelect={onSelect}
            path={path}
            selectedPath={selectedPath}
            threadId={threadId}
          />
        ) : null}
      </div>
    </li>
  );
}

interface EntryListProps {
  depth: number;
  entries: WorkspaceEntry[];
  onSelect: (path: string) => void;
  path: string;
  selectedPath: string | undefined;
  threadId: string;
}

export function EntryList({
  depth,
  entries,
  onSelect,
  path,
  selectedPath,
  threadId,
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
            threadId={threadId}
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
  threadId,
}: DirectoryEntriesProps) {
  const directoryQuery = useQuery(directoryOptions(threadId, path));

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
      threadId={threadId}
    />
  );
}
