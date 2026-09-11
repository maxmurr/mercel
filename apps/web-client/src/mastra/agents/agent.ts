import { randomUUID } from "node:crypto";
import { Agent } from "@mastra/core/agent";
import { smoothStream } from "@mastra/core/stream";
import { z } from "zod";

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
      id: "opencode-go/deepseek-flash",
    };
  },
  name: "Agent",
  requestContextSchema: z.object({
    opencodeSessionId: z.uuid().optional(),
  }),
});
