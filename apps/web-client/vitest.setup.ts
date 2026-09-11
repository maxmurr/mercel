import { createTool } from "@mastra/core/tools";
import { vi } from "vitest";
import { z } from "zod";

// The agent lists Exa's hosted MCP tools on every run; stub it so tests stay offline.
vi.mock("@mastra/mcp", () => ({
  MCPClient: class {
    listTools() {
      return Promise.resolve({
        exa_web_search_exa: createTool({
          description: "Stubbed Exa web search",
          execute: () => Promise.resolve(""),
          id: "exa_web_search_exa",
          inputSchema: z.object({ query: z.string() }),
        }),
      });
    }
  },
}));
