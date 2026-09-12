import { beforeEach, expect, it } from "vitest";
import {
  handleSandboxData,
  lastPreviewUrl,
  useSandboxStore,
} from "@/lib/sandbox-store";

beforeEach(() => {
  useSandboxStore.setState({ lastLogSeq: 0, logs: [], preview: undefined });
});

it("opens the preview and bumps the revision on every URL", () => {
  handleSandboxData({
    data: { url: "http://localhost:5173" },
    type: "data-preview",
  });
  expect(useSandboxStore.getState().preview).toEqual({
    revision: 1,
    url: "http://localhost:5173",
  });

  handleSandboxData({
    data: { url: "http://localhost:5173" },
    type: "data-preview",
  });
  expect(useSandboxStore.getState().preview?.revision).toBe(2);

  handleSandboxData({ data: { nope: true }, type: "data-preview" });
  expect(useSandboxStore.getState().preview?.revision).toBe(2);
});

it("turns streamed command output into console lines", () => {
  handleSandboxData({
    data: { output: "installing…\n", timestamp: 1000 },
    type: "data-sandbox-stdout",
  });
  handleSandboxData({
    data: { output: "warning\n", timestamp: 2000 },
    type: "data-sandbox-stderr",
  });
  handleSandboxData({
    data: { exitCode: 1, success: false },
    type: "data-sandbox-exit",
  });
  handleSandboxData({ data: {}, type: "data-workspace-metadata" });

  expect(
    useSandboxStore
      .getState()
      .logs.map(({ level, message }) => ({ level, message }))
  ).toEqual([
    { level: "log", message: "installing…" },
    { level: "error", message: "warning" },
    { level: "error", message: "Exit code 1" },
  ]);
});

it("appends only unseen process log entries", () => {
  const { appendProcessLogs } = useSandboxStore.getState();
  const entry = (seq: number, stream: "stdout" | "stderr" = "stdout") => ({
    pid: "42",
    seq,
    stream,
    text: `line ${seq}\n`,
    timestamp: seq,
  });

  appendProcessLogs([entry(1), entry(2, "stderr")]);
  appendProcessLogs([entry(2, "stderr"), entry(3)]);
  appendProcessLogs([]);

  const { lastLogSeq, logs } = useSandboxStore.getState();
  expect(lastLogSeq).toBe(3);
  expect(
    logs.map(({ id, level, message }) => ({ id, level, message }))
  ).toEqual([
    { id: "process-1", level: "log", message: "[42] line 1" },
    { id: "process-2", level: "error", message: "[42] line 2" },
    { id: "process-3", level: "log", message: "[42] line 3" },
  ]);
});

it("restores the preview a stored conversation last opened", () => {
  const previewCall = (url: string | undefined, toolCallId: string) => ({
    input: { pid: "42" },
    output: { message: `Preview opened at ${url}`, url },
    state: "output-available" as const,
    toolCallId,
    type: "tool-open_preview" as const,
  });

  expect(lastPreviewUrl([])).toBeUndefined();
  expect(
    lastPreviewUrl([
      {
        id: "assistant-1",
        parts: [
          previewCall("http://localhost:5173", "call-1"),
          { text: "Restarted it", type: "text" },
        ],
        role: "assistant",
      },
      {
        id: "assistant-2",
        // A dev server that never printed a URL leaves the field out.
        parts: [previewCall(undefined, "call-2")],
        role: "assistant",
      },
    ])
  ).toBe("http://localhost:5173");
});
