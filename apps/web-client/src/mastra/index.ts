import { Mastra } from "@mastra/core";
import { agent } from "./agents/agent";

/** Mastra registry for server-side code and the local Studio CLI. */
export const mastra = new Mastra({
  agents: { agent },
});
