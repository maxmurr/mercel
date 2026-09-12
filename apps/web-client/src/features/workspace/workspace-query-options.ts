import { queryOptions, skipToken } from "@tanstack/react-query";
import { useSandboxStore } from "@/features/workspace/hooks/use-sandbox-store";
import type { ProcessLogEntry } from "@/features/workspace/types/process-log-entry";
import type { WorkspaceEntry } from "@/features/workspace/types/workspace-entry";
import {
  fetchDeploymentStatus,
  shouldRetryDeploymentStatus,
} from "@/features/workspace/workspace-deployment";

const workspaceFilesApi = "/api/workspace";
const hiddenEntries = new Set(["node_modules", ".git"]);
const liveRefreshMs = 2000;

export const rootPath = ".";

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

export function deploymentStatusOptions(id: string | undefined) {
  return queryOptions({
    enabled: Boolean(id),
    queryFn: id ? ({ signal }) => fetchDeploymentStatus(id, signal) : skipToken,
    queryKey: ["deployment", id],
    refetchInterval: (query) =>
      query.state.status === "error" ||
      query.state.data === "completed" ||
      query.state.data === "failed"
        ? false
        : liveRefreshMs,
    refetchIntervalInBackground: true,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: shouldRetryDeploymentStatus,
    staleTime: 0,
  });
}

async function fetchProcessLogs(threadId: string) {
  const after = useSandboxStore.getState().lastLogSeq;
  const response = await fetch(
    `/api/sandbox/logs/${encodeURIComponent(threadId)}?after=${after}`
  );
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  const data: { entries: ProcessLogEntry[] } = await response.json();
  return data.entries;
}

export function processLogsOptions(threadId: string) {
  return queryOptions({
    queryFn: () => fetchProcessLogs(threadId),
    queryKey: ["sandbox-process-logs", threadId],
    refetchInterval: liveRefreshMs,
    staleTime: 0,
  });
}
