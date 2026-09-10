// @vitest-environment node

import { expect, it } from "vitest";
import { mastra } from "../index";

it("registers Agent with DeepSeek V4.1 Flash through OpenCode Go", async () => {
  const agent = mastra.getAgentById("agent");
  const model = await agent.getModel();

  expect(agent.name).toBe("Agent");
  expect(model.provider).toBe("opencode-go");
  expect(model.modelId).toBe("deepseek-flash");
});
