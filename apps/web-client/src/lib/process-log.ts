export interface ProcessLogEntry {
  pid: string;
  seq: number;
  stream: "stdout" | "stderr" | "exit";
  text: string;
  timestamp: number;
}

interface ProcessLogBuffer {
  entries: ProcessLogEntry[];
  nextSeq: number;
}

const maxEntries = 1000;

// Lives on globalThis so the API route and the agent share one buffer across Next's module instances and HMR reloads.
const globalStore = globalThis as typeof globalThis & {
  mercelProcessLog?: ProcessLogBuffer;
};
if (!globalStore.mercelProcessLog) {
  globalStore.mercelProcessLog = { entries: [], nextSeq: 1 };
}
const buffer = globalStore.mercelProcessLog;

/** Keeps the tail of background process output (dev servers) so the web client can poll it. */
export function recordProcessLog(
  entry: Omit<ProcessLogEntry, "seq" | "timestamp">
) {
  buffer.entries.push({ ...entry, seq: buffer.nextSeq, timestamp: Date.now() });
  buffer.nextSeq += 1;
  if (buffer.entries.length > maxEntries) {
    buffer.entries.splice(0, buffer.entries.length - maxEntries);
  }
}

/** Returns entries newer than `after`, so clients can poll incrementally. */
export function readProcessLogs(after: number) {
  return buffer.entries.filter((entry) => entry.seq > after);
}
