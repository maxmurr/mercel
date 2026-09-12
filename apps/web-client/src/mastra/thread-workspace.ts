import { LocalFilesystem, LocalSandbox } from "@mastra/core/workspace";

/** Root holding every thread's directory, resolved from process.cwd(). */
const sandboxRoot = ".sandbox";

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
// ponytail: nothing reaps these, so a thread's sandbox and its dev servers live until the server
// restarts; add an idle TTL that destroys the sandbox and clears the workspace cache before this
// serves more than one person.
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
 * The thread's sandbox, created on first use and reused afterwards so the dev
 * servers it started stay reachable across turns.
 */
export function threadSandbox(threadId: string): LocalSandbox {
  const workingDirectory = threadWorkspaceDir(threadId);
  const cached = sandboxes.get(threadId);
  if (cached) {
    return cached;
  }
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
