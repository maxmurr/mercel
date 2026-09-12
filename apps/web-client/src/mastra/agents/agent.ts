import { randomUUID } from "node:crypto";
import { Agent } from "@mastra/core/agent";
import type { RequestContext } from "@mastra/core/request-context";
import { smoothStream } from "@mastra/core/stream";
import { webFetchTool } from "@mastra/core/tools";
import { WORKSPACE_TOOLS, Workspace } from "@mastra/core/workspace";
import { Memory } from "@mastra/memory";
import { z } from "zod";
import { recordProcessLog } from "../../lib/process-log";
import { designBriefProcessor } from "../processors/design-brief";
import { threadFilesystem, threadSandbox } from "../thread-workspace";
import { exa } from "../tools/exa";
import { openPreviewTool } from "../tools/preview";
import instructions from "./instructions.md";

/** Agent Skills (`SKILL.md` dirs), resolved from process.cwd(). */
const skillsDir = "src/mastra/skills";

/** Thread the files and commands belong to, when the request names one. */
function threadIdFrom(requestContext: RequestContext): string | undefined {
  const threadId = requestContext.get("threadId");
  return typeof threadId === "string" ? threadId : undefined;
}

/**
 * Same, for commands. Every chat owns a separate sandbox, so a request that
 * names no thread has nowhere to run rather than a shared one to fall back on.
 */
function requireThreadId(requestContext: RequestContext): string {
  const threadId = threadIdFrom(requestContext);
  if (!threadId) {
    throw new Error(
      "The sandbox is per thread: send threadId in the request context."
    );
  }
  return threadId;
}

/** Writing files, installing, starting the server, and previewing takes many tool rounds. */
const maxSteps = 40;

/** Turns replayed into the model's context; the UI still reloads the whole thread. */
const lastMessages = 20;

/** OpenCode Go routes by session header and identifies the client by User-Agent. */
function openCodeModel(sessionId: string) {
  return {
    headers: {
      "User-Agent": "mercel/0.1.0",
      "x-opencode-session": sessionId,
    },
    id: "opencode-go/glm-5.3-flash" as const,
  };
}

/**
 * Naming a thread runs outside the conversation it names: its own routing
 * session keeps the coding session's context from bleeding into the name.
 */
const titleModel = () => openCodeModel(randomUUID());

/**
 * Mastra hands the title model the whole transcript, the assistant's reply
 * included, and its default prompt lets a small model echo that reply back as
 * the title. Naming what was asked for, and nothing else, is the fix.
 */
const titleInstructions = `You name a conversation between a user and an assistant.
- Name what the user asked for, never what the assistant did, built, or said.
- Never copy, quote, or summarise the assistant's reply.
- At most six words, no markdown, no quotes, no colons, no trailing period.
- Return the name and nothing else.`;

/** Reuse request context across turns to keep the OpenCode routing session stable. */
export const agent = new Agent({
  defaultOptions: {
    experimentalTransform: () => smoothStream({ delayInMs: 20 }),
    maxSteps,
  },
  id: "agent",
  inputProcessors: [designBriefProcessor],
  instructions,
  // Storage comes from the Mastra instance, so threads land in the app's Postgres.
  // Titles are generated after the turn, so the sidebar can name a thread without
  // slowing the reply down.
  memory: new Memory({
    options: {
      generateTitle: { instructions: titleInstructions, model: titleModel },
      lastMessages,
    },
  }),
  model: ({ requestContext }) => {
    const sessionId = requestContext.get("opencodeSessionId") ?? randomUUID();
    requestContext.set("opencodeSessionId", sessionId);

    return openCodeModel(sessionId);
  },
  name: "Agent",
  requestContextSchema: z.object({
    opencodeSessionId: z.uuid().optional(),
    threadId: z.uuid().optional(),
  }),
  skills: [skillsDir],
  tools: async () => ({
    web_fetch: webFetchTool,
    ...(await exa.listTools()),
    open_preview: openPreviewTool,
  }),
  workspace: new Workspace({
    bm25: true,
    filesystem: ({ requestContext }) =>
      threadFilesystem(threadIdFrom(requestContext)),
    id: "sandbox",
    // Resolved on every request rather than cached by thread here: the thread
    // cache in thread-workspace.ts returns the same live sandbox, dev servers
    // included, and sees each turn so the idle TTL counts from the last one.
    sandbox: ({ requestContext }) =>
      threadSandbox(requireThreadId(requestContext)),
    tools: {
      [WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]: {
        requireReadBeforeWrite: true,
      },
      [WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE]: {
        requireReadBeforeWrite: true,
      },
      [WORKSPACE_TOOLS.FILESYSTEM.DELETE]: {
        requireApproval: true,
      },
      // Dev servers must outlive the chat request that started them; their output is polled by the console.
      [WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND]: {
        backgroundProcesses: {
          abortSignal: false,
          onExit: ({ pid, exitCode }) =>
            recordProcessLog({
              pid,
              stream: "exit",
              text: `exited with code ${exitCode}`,
            }),
          onStderr: (data, { pid }) =>
            recordProcessLog({ pid, stream: "stderr", text: data }),
          onStdout: (data, { pid }) =>
            recordProcessLog({ pid, stream: "stdout", text: data }),
        },
      },
    },
  }),
});
