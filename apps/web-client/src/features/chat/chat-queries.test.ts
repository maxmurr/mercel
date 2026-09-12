// @vitest-environment node

import { afterEach, expect, it, vi } from "vitest";
import { getChatThread, getChatThreads } from "@/features/chat/chat-queries";
import { mastra } from "@/mastra";

let userId: string | undefined = "query-user";

vi.mock("@/features/user/user-auth", () => ({
  auth: {
    api: {
      getSession: () =>
        Promise.resolve(userId ? { user: { id: userId } } : null),
    },
  },
}));

afterEach(() => {
  userId = "query-user";
});

it("refuses unauthenticated history and list reads", async () => {
  userId = undefined;
  const threads = await getChatThreads(new Headers());
  const thread = await getChatThread(crypto.randomUUID(), new Headers());
  expect(threads).toBeInstanceOf(Response);
  expect(thread).toBeInstanceOf(Response);
  expect(threads instanceof Response && threads.status).toBe(401);
  expect(thread instanceof Response && thread.status).toBe(401);
});

it("opens an unsaved thread under the signed-in account without inventing history", async () => {
  const thread = await getChatThread(crypto.randomUUID(), new Headers());
  expect(thread).toEqual({
    isStreaming: false,
    messages: [],
    resourceId: "query-user",
  });
});

it("refuses another account's thread before recalling its messages", async () => {
  const memory = await mastra.getAgentById("agent").getMemory();
  if (!memory) {
    throw new Error("Chat query test memory missing");
  }
  const stored = await memory.createThread({
    resourceId: "another-user",
    threadId: crypto.randomUUID(),
  });
  const recall = vi.spyOn(memory, "recall");
  const result = await getChatThread(stored.id, new Headers());
  expect(result instanceof Response && result.status).toBe(403);
  expect(recall).not.toHaveBeenCalled();
});

it("returns only the current account's sidebar fields with serializable dates", async () => {
  const memory = await mastra.getAgentById("agent").getMemory();
  if (!memory) {
    throw new Error("Chat query test memory missing");
  }
  userId = crypto.randomUUID();
  const stored = await memory.createThread({
    metadata: { deploymentId: "abc12", privateField: "not-for-the-browser" },
    resourceId: userId,
    threadId: crypto.randomUUID(),
    title: "Server-seeded chat",
  });
  await memory.createThread({
    resourceId: "another-user",
    threadId: crypto.randomUUID(),
  });
  expect(await getChatThreads(new Headers())).toEqual([
    {
      deploymentId: "abc12",
      id: stored.id,
      title: "Server-seeded chat",
      updatedAt: stored.updatedAt.toISOString(),
    },
  ]);
});
