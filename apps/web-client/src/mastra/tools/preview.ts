import { createTool } from "@mastra/core/tools";
import type { ProcessHandle } from "@mastra/core/workspace";
import { z } from "zod";

const localUrlPattern = /https?:\/\/localhost:\d+/;
const pollIntervalMs = 500;
const timeoutMs = 60_000;
const tailLines = 20;

const output = (handle: ProcessHandle) => `${handle.stdout}\n${handle.stderr}`;

const tail = (text: string) =>
  text.trim().split("\n").slice(-tailLines).join("\n");

/** Polls retained process output until a localhost URL appears, the process exits, or time runs out. */
function waitForLocalUrl(handle: ProcessHandle) {
  const deadline = Date.now() + timeoutMs;
  return new Promise<string | undefined>((resolve) => {
    const check = () => {
      const match = localUrlPattern.exec(output(handle));
      if (match) {
        resolve(match[0]);
        return;
      }
      if (handle.exitCode !== undefined || Date.now() >= deadline) {
        resolve(undefined);
        return;
      }
      setTimeout(check, pollIntervalMs);
    };
    check();
  });
}

/** Finds the URL a background dev server printed and pushes it to the preview panel. */
export const openPreviewTool = createTool({
  description:
    "Show a running dev server in the preview panel. Pass the PID returned by execute_command with background: true. Waits until the process prints its http://localhost:PORT URL and reports the reason if it cannot.",
  execute: async ({ pid }, { workspace, writer }) => {
    const handle = await workspace?.sandbox?.processes?.get(pid);
    if (!handle) {
      return `No background process with PID ${pid}. Start the dev server with execute_command (background: true) first.`;
    }
    const url = await waitForLocalUrl(handle);
    if (url) {
      await writer?.custom({
        data: { url },
        transient: true,
        type: "data-preview",
      });
      return `Preview opened at ${url}`;
    }
    const reason =
      handle.exitCode === undefined
        ? `printed no http://localhost URL within ${timeoutMs / 1000}s`
        : `exited with code ${handle.exitCode} before printing a URL`;
    return `Process ${pid} ${reason}.\n${tail(output(handle))}`;
  },
  id: "open_preview",
  inputSchema: z.object({
    pid: z.string().describe("PID of the background dev server process"),
  }),
});
