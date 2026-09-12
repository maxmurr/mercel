import { MCPClient } from "@mastra/mcp";

/** Exa hosted MCP (web_search_exa, web_fetch_exa). Free plan without a key; EXA_API_KEY lifts rate limits. */
export const exa = new MCPClient({
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
