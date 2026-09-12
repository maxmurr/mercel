import type { DataUIPart, UIDataTypes } from "ai";
import { z } from "zod";
import { create } from "zustand";
import type { WebPreviewConsoleLog } from "@/components/ai-elements/web-preview";
import type { ProcessLogEntry } from "@/lib/process-log";

const maxLogs = 500;

const previewSchema = z.object({ url: z.string() });
const outputSchema = z.object({ output: z.string(), timestamp: z.number() });
const exitSchema = z.object({ exitCode: z.number(), success: z.boolean() });

interface SandboxState {
  appendLogs: (logs: WebPreviewConsoleLog[]) => void;
  appendProcessLogs: (entries: ProcessLogEntry[]) => void;
  lastLogSeq: number;
  logs: WebPreviewConsoleLog[];
  openPreview: (url: string) => void;
  preview?: { revision: number; url: string } | undefined;
}

function toConsoleLog(entry: ProcessLogEntry): WebPreviewConsoleLog {
  return {
    id: `process-${entry.seq}`,
    level: entry.stream === "stdout" ? "log" : "error",
    message: `[${entry.pid}] ${entry.text.trimEnd()}`,
    timestamp: new Date(entry.timestamp),
  };
}

/** Preview URL and console output for the shared sandbox; outlives individual chat sessions. */
export const useSandboxStore = create<SandboxState>()((set) => ({
  appendLogs: (logs) =>
    set((state) => ({ logs: [...state.logs, ...logs].slice(-maxLogs) })),
  appendProcessLogs: (entries) =>
    set((state) => {
      const fresh = entries.filter((entry) => entry.seq > state.lastLogSeq);
      const last = fresh.at(-1);
      if (!last) {
        return state;
      }
      return {
        lastLogSeq: last.seq,
        logs: [...state.logs, ...fresh.map(toConsoleLog)].slice(-maxLogs),
      };
    }),
  lastLogSeq: 0,
  logs: [],
  // Bumping the revision remounts the iframe so a restarted server reloads even at the same URL.
  openPreview: (url) =>
    set((state) => ({
      preview: { revision: (state.preview?.revision ?? 0) + 1, url },
    })),
}));

/** Routes Mastra data parts from the chat stream into preview and console state. */
export function handleSandboxData(part: DataUIPart<UIDataTypes>) {
  const { appendLogs, openPreview } = useSandboxStore.getState();
  switch (part.type) {
    case "data-preview": {
      const preview = previewSchema.safeParse(part.data);
      if (preview.success) {
        openPreview(preview.data.url);
      }
      return;
    }
    case "data-sandbox-stdout":
    case "data-sandbox-stderr": {
      const output = outputSchema.safeParse(part.data);
      if (output.success) {
        appendLogs([
          {
            id: crypto.randomUUID(),
            level: part.type === "data-sandbox-stderr" ? "error" : "log",
            message: output.data.output.trimEnd(),
            timestamp: new Date(output.data.timestamp),
          },
        ]);
      }
      return;
    }
    case "data-sandbox-exit": {
      const exit = exitSchema.safeParse(part.data);
      if (exit.success) {
        appendLogs([
          {
            id: crypto.randomUUID(),
            level: exit.data.success ? "log" : "error",
            message: `Exit code ${exit.data.exitCode}`,
            timestamp: new Date(),
          },
        ]);
      }
      return;
    }
    default:
      return;
  }
}
