import { queryOptions } from "@tanstack/react-query";

const workspaceFilesApi = "/api/workspace";
const hiddenEntries = new Set(["node_modules", ".git"]);
// The agent keeps editing files, so folders and the open file refresh while the tab is visible.
const liveRefreshMs = 2000;

export const rootPath = ".";

export interface WorkspaceEntry {
  name: string;
  size?: number;
  type: "directory" | "file";
}

async function fetchWorkspace<T>(
  threadId: string,
  endpoint: "list" | "read",
  path: string
): Promise<T> {
  const response = await fetch(
    `${workspaceFilesApi}/${encodeURIComponent(threadId)}/${endpoint}?path=${encodeURIComponent(path)}`
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

export function directoryOptions(threadId: string, path: string) {
  return queryOptions({
    queryFn: () =>
      fetchWorkspace<{ entries: WorkspaceEntry[] }>(threadId, "list", path),
    queryKey: ["workspace-directory", threadId, path],
    refetchInterval: liveRefreshMs,
    select: (data) =>
      data.entries
        .filter((entry) => !hiddenEntries.has(entry.name))
        .toSorted(compareEntries),
    staleTime: 0,
  });
}

export function fileOptions(threadId: string, path: string) {
  return queryOptions({
    queryFn: () => fetchWorkspace<{ content: string }>(threadId, "read", path),
    queryKey: ["workspace-file", threadId, path],
    refetchInterval: liveRefreshMs,
    select: (data) => data.content,
    staleTime: 0,
  });
}

export function childPath(parentPath: string, name: string) {
  return parentPath === rootPath ? name : `${parentPath}/${name}`;
}
