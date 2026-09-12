"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { WebPreviewConsole } from "@/components/ai-elements/web-preview";
import type { ProcessLogEntry } from "@/lib/process-log";
import { useSandboxStore } from "@/lib/sandbox-store";

const processLogsApi = "/api/sandbox/logs";
const pollIntervalMs = 2000;

async function fetchProcessLogs() {
  const after = useSandboxStore.getState().lastLogSeq;
  const response = await fetch(`${processLogsApi}?after=${after}`);
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  const data: { entries: ProcessLogEntry[] } = await response.json();
  return data.entries;
}

/** Console drawer fed by streamed command output plus polled dev-server logs. */
export function SandboxConsole() {
  const [isOpen, setIsOpen] = useState(false);
  const logs = useSandboxStore((state) => state.logs);
  const hasPreview = useSandboxStore((state) => state.preview !== undefined);
  const appendProcessLogs = useSandboxStore((state) => state.appendProcessLogs);
  // Background processes only report to the server, so poll while anyone is looking.
  const { data: entries } = useQuery({
    enabled: isOpen || hasPreview,
    queryFn: fetchProcessLogs,
    queryKey: ["sandbox-process-logs"],
    refetchInterval: pollIntervalMs,
    staleTime: 0,
  });

  useEffect(() => {
    if (entries) {
      appendProcessLogs(entries);
    }
  }, [appendProcessLogs, entries]);

  return (
    <WebPreviewConsole logs={logs} onOpenChange={setIsOpen} open={isOpen} />
  );
}
