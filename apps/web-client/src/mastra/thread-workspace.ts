import { cpSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { LocalFilesystem, LocalSandbox } from "@mastra/core/workspace";

/** Root holding every thread's directory, resolved from process.cwd(). */
const sandboxRoot = ".sandbox";

/** Starter project a new thread begins from, resolved from process.cwd(). */
const templateDir = "templates/vite-react";

// The launcher mints thread ids with crypto.randomUUID(), and they become directory names.
const threadIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Lives on globalThis so the agent and the API routes share one cache across Next's module instances and HMR reloads.
const globalStore = globalThis as typeof globalThis & {
  mercelThreadSandboxes?: Map<string, LocalSandbox>;
};
if (!globalStore.mercelThreadSandboxes) {
  globalStore.mercelThreadSandboxes = new Map();
}
const sandboxes = globalStore.mercelThreadSandboxes;

/**
 * Directory a thread's files live in, relative to process.cwd().
 *
 * @throws When the thread ID is not one the launcher could have minted. The ID
 * reaches the server from the URL and becomes a path segment, so anything else
 * is rejected rather than resolved.
 */
export function threadWorkspaceDir(threadId: string): string {
  if (!threadIdPattern.test(threadId)) {
    throw new Error(`Invalid thread ID: ${threadId}`);
  }
  return `${sandboxRoot}/${threadId}`;
}

/**
 * File access for one thread, contained to that thread's directory.
 *
 * Mastra also resolves a filesystem while building workspace instructions, and
 * a caller outside the chat (Studio, a test) names no thread there. Those fall
 * back to the bare root; the chat itself always sends its thread ID.
 */
export function threadFilesystem(
  threadId: string | undefined
): LocalFilesystem {
  return new LocalFilesystem({
    basePath: threadId ? threadWorkspaceDir(threadId) : sandboxRoot,
  });
}

/**
 * Copies the starter into a thread's directory the first time the thread runs.
 *
 * A directory that already exists is left alone: after a server restart the
 * sandbox cache is empty but the thread's files are not, and older threads
 * predate the starter.
 */
function seedThreadWorkspace(workingDirectory: string): void {
  if (existsSync(workingDirectory)) {
    return;
  }
  cpSync(templateDir, workingDirectory, {
    // A developer may have installed inside the template; each thread installs its own.
    filter: (source) => basename(source) !== "node_modules",
    recursive: true,
  });
}

/**
 * The thread's sandbox, created on first use and reused afterwards so the dev
 * servers it started stay reachable across turns.
 */
export function threadSandbox(threadId: string): LocalSandbox {
  const workingDirectory = threadWorkspaceDir(threadId);
  const cached = sandboxes.get(threadId);
  if (cached) {
    return cached;
  }
  seedThreadWorkspace(workingDirectory);
  // LocalSandbox starts itself on the first command, so nothing here has to wait for it.
  const sandbox = new LocalSandbox({
    env: {
      HOME: process.env.HOME,
      NODE_ENV: process.env.NODE_ENV,
      PATH: process.env.PATH,
    },
    isolation: process.platform === "darwin" ? "seatbelt" : "bwrap",
    nativeSandbox: {
      allowNetwork: true,
      readWritePaths: [`${process.env.HOME}/.npm`],
    },
    workingDirectory,
  });
  sandboxes.set(threadId, sandbox);
  return sandbox;
}

/** The thread's sandbox only if it already exists; polling must not provision one. */
export function existingThreadSandbox(
  threadId: string
): LocalSandbox | undefined {
  return sandboxes.get(threadId);
}
