import {
  type DataUIPart,
  getToolName,
  isToolUIPart,
  type UIDataTypes,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { create } from "zustand";
import type { WebPreviewConsoleLog } from "@/components/ai-elements/web-preview";
import type { ProcessLogEntry } from "@/features/workspace/types/process-log-entry";

const maxLogs = 500;

// Matches the data part written by open_preview and that tool's own output field.
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
  resetForThread: (threadId: string) => void;
  threadId?: string | undefined;
}

function toConsoleLog(entry: ProcessLogEntry): WebPreviewConsoleLog {
  return {
    id: `process-${entry.seq}`,
    level: entry.stream === "stdout" ? "log" : "error",
    message: `[${entry.pid}] ${entry.text.trimEnd()}`,
    timestamp: new Date(entry.timestamp),
  };
}

/** Preview URL and console output for the open thread's sandbox; one store, swapped per thread. */
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
  // The store outlives client navigation, so opening another thread must not inherit its preview or console.
  resetForThread: (threadId) =>
    set((state) =>
      state.threadId === threadId
        ? state
        : { lastLogSeq: 0, logs: [], preview: undefined, threadId }
    ),
}));

/**
 * Finds the preview a stored conversation last opened. Dev servers outlive the
 * page, so a reloaded thread can show the same preview instead of an empty panel.
 */
export function lastPreviewUrl(messages: UIMessage[]): string | undefined {
  for (const message of messages.toReversed()) {
    for (const part of message.parts.toReversed()) {
      if (
        !isToolUIPart(part) ||
        getToolName(part) !== "open_preview" ||
        part.state !== "output-available"
      ) {
        continue;
      }
      const preview = previewSchema.safeParse(part.output);
      if (preview.success) {
        return preview.data.url;
      }
    }
  }
}

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
