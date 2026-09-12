"use client";

import { useQuery } from "@tanstack/react-query";
import { FileIcon, FolderIcon, PanelLeftOpenIcon } from "lucide-react";
import { Fragment, useCallback, useState } from "react";
import { WebPreviewNavigationButton } from "@/components/ai-elements/web-preview";
import { SandboxConsole } from "@/components/chat/sandbox-console";
import { FileBody } from "@/components/chat/workspace-code";
import { directoryOptions, rootPath } from "@/components/chat/workspace-files";
import { EntryList, TreeSkeleton } from "@/components/chat/workspace-tree";
import { EmptyState } from "@/components/empty-state";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";

const fileTreeId = "workspace-file-tree";

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

interface FilePaneProps {
  onShowTree: () => void;
  selectedPath: string | undefined;
  threadId: string;
}

function FilePane({ onShowTree, selectedPath, threadId }: FilePaneProps) {
  if (selectedPath === undefined) {
    return (
      <EmptyState
        description="Pick a file from the tree to read it."
        icon={<FileIcon />}
        title="No file selected"
      />
    );
  }

  return (
    <>
      <FileHeader onShowTree={onShowTree} path={selectedPath} />
      <FileBody path={selectedPath} threadId={threadId} />
    </>
  );
}

/** Fills the tab when there is nothing to browse: no sandbox yet, or a sandbox without files. */
function WorkspaceEmpty({ title }: { title: string }) {
  return (
    <EmptyState
      description="Ask the agent to build something and its files will show up here."
      icon={<FolderIcon />}
      title={title}
    />
  );
}

/** Browses the agent's sandbox: a lazily loaded file tree beside a read-only, highlighted viewer. */
function WorkspaceBrowser({ threadId }: { threadId: string }) {
  const rootQuery = useQuery(directoryOptions(threadId, rootPath));
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
              threadId={threadId}
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
          <FilePane
            onShowTree={handleShowTree}
            selectedPath={selectedPath}
            threadId={threadId}
          />
        ) : null}
      </section>
    </>
  );
}

export function ChatCode({
  className,
  threadId,
}: {
  className?: string;
  threadId: string;
}) {
  return (
    <div className={cn("flex h-full min-h-0 min-w-0 flex-col", className)}>
      <div className="@container flex min-h-0 min-w-0 flex-1">
        <WorkspaceBrowser threadId={threadId} />
      </div>
      <SandboxConsole threadId={threadId} />
    </div>
  );
}
