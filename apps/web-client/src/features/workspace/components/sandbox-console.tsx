"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { WebPreviewConsole } from "@/components/ai-elements/web-preview";
import { useSandboxStore } from "@/features/workspace/hooks/use-sandbox-store";
import { processLogsOptions } from "@/features/workspace/workspace-query-options";

/** Console drawer fed by streamed command output plus polled dev-server logs. */
export function SandboxConsole({ threadId }: { threadId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const logs = useSandboxStore((state) => state.logs);
  const hasPreview = useSandboxStore((state) => state.preview !== undefined);
  const appendProcessLogs = useSandboxStore((state) => state.appendProcessLogs);
  // Background processes only report to the server, so poll while anyone is looking.
  const { data: entries } = useQuery({
    ...processLogsOptions(threadId),
    enabled: isOpen || hasPreview,
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
