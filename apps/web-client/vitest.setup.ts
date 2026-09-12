import { InMemoryStore } from "@mastra/core/storage";
import { createTool } from "@mastra/core/tools";
import { vi } from "vitest";
import { z } from "zod";

// Agent memory persists to Postgres; swap in the in-memory store so tests stay
// offline and their fake timers are not waiting on a database round trip.
vi.mock("@mastra/pg", () => ({ PostgresStore: InMemoryStore }));

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
