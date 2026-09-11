// @vitest-environment node

import { afterEach, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("lists the registered agent through the native API prefix", async () => {
  const response = await GET(
    new Request("http://localhost:3002/api/mastra/agents")
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ agent: { name: "Agent" } });
});

it("does not serve Mastra routes outside the configured prefix", async () => {
  const response = await GET(new Request("http://localhost:3002/api/agents"));

  expect(response.status).toBe(404);
});

it("rejects missing messages without calling the provider", async () => {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  const response = await POST(
    new Request("http://localhost:3002/api/mastra/agents/agent/generate", {
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );

  expect(response.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});
