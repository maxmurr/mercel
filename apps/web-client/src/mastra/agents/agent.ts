import { randomUUID } from "node:crypto";
import { Agent } from "@mastra/core/agent";
import { smoothStream } from "@mastra/core/stream";
import { webFetchTool } from "@mastra/core/tools";
import {
  LocalFilesystem,
  LocalSandbox,
  WORKSPACE_TOOLS,
  Workspace,
} from "@mastra/core/workspace";
import { Memory } from "@mastra/memory";
import { z } from "zod";
import { recordProcessLog } from "../../lib/process-log";
import { designBriefProcessor } from "../processors/design-brief";
import { exa } from "../tools/exa";
import { openPreviewTool } from "../tools/preview";
import instructions from "./instructions.md";

/** Shared root for file tools and shell commands, resolved from process.cwd(). */
const workspaceDir = ".sandbox";

/** Agent Skills (`SKILL.md` dirs), resolved from process.cwd() like workspaceDir. */
const skillsDir = "src/mastra/skills";

/** Writing files, installing, starting the server, and previewing takes many tool rounds. */
const maxSteps = 40;

/** Turns replayed into the model's context; the UI still reloads the whole thread. */
const lastMessages = 20;

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
  memory: new Memory({ options: { lastMessages } }),
  model: ({ requestContext }) => {
    const sessionId = requestContext.get("opencodeSessionId") ?? randomUUID();
    requestContext.set("opencodeSessionId", sessionId);

    return {
      headers: {
        "User-Agent": "mercel/0.1.0",
        "x-opencode-session": sessionId,
      },
      id: "opencode-go/glm-5.3-flash",
    };
  },
  name: "Agent",
  requestContextSchema: z.object({
    opencodeSessionId: z.uuid().optional(),
  }),
  skills: [skillsDir],
  tools: async () => ({
    web_fetch: webFetchTool,
    ...(await exa.listTools()),
    open_preview: openPreviewTool,
  }),
  workspace: new Workspace({
    bm25: true,
    filesystem: new LocalFilesystem({ basePath: workspaceDir }),
    // Stable id so the web client can address this workspace's filesystem routes.
    id: "sandbox",
    sandbox: new LocalSandbox({
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
      workingDirectory: workspaceDir,
    }),
    tools: {
      // Require reading a file before editing it (safer)
      [WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]: {
        requireReadBeforeWrite: true,
      },
      [WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE]: {
        requireReadBeforeWrite: true,
      },
      // Ask for approval before deleting anything
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
