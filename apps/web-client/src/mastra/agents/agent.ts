import { Agent } from "@mastra/core/agent";

/** Simple assistant; reads OPENCODE_API_KEY on the server. */
export const agent = new Agent({
  id: "agent",
  instructions: "You are a helpful assistant. Give clear, concise answers.",
  model: "opencode-go/deepseek-flash",
  name: "Agent",
});
