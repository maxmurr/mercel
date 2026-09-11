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
import { MCPClient } from "@mastra/mcp";
import { z } from "zod";

/** Shared root for file tools and shell commands, resolved from process.cwd(). */
const workspaceDir = ".sandbox";

/** Exa hosted MCP (web_search_exa, web_fetch_exa). Free plan without a key; EXA_API_KEY lifts rate limits. */
const exa = new MCPClient({
  servers: {
    exa: {
      requestInit: {
        headers: process.env.EXA_API_KEY
          ? { "x-api-key": process.env.EXA_API_KEY }
          : {},
      },
      url: new URL("https://mcp.exa.ai/mcp"),
    },
  },
});

/** Reuse request context across turns to keep the OpenCode routing session stable. */
export const agent = new Agent({
  defaultOptions: {
    experimentalTransform: () => smoothStream({ delayInMs: 20 }),
  },
  id: "agent",
  instructions: "You are a helpful assistant. Give clear, concise answers.",
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
  // ponytail: one tools/list round trip to Exa per run; memoize if latency shows.
  tools: async () => ({
    web_fetch: webFetchTool,
    ...(await exa.listTools()),
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
      // Stream dev server output
      [WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND]: {
        backgroundProcesses: {
          onExit: ({ pid, exitCode }) =>
            console.log(`Process ${pid} exited: ${exitCode}`),
          onStderr: (data, { pid }) => console.error(`[${pid}] ${data}`),
          onStdout: (data, { pid }) => console.log(`[${pid}] ${data}`),
        },
      },
    },
  }),
});
