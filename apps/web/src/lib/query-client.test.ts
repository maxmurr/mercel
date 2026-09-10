import { environmentManager } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { getQueryClient } from "./query-client";

it("isolates query caches between server renders", () => {
  vi.spyOn(environmentManager, "isServer").mockReturnValue(true);

  const firstClient = getQueryClient();
  firstClient.setQueryData(["session"], { userId: "first-user" });
  const secondClient = getQueryClient();

  expect(secondClient).not.toBe(firstClient);
  expect(secondClient.getQueryData(["session"])).toBeUndefined();
  firstClient.clear();
  secondClient.clear();
});

it("reuses the browser query cache across renders", () => {
  vi.spyOn(environmentManager, "isServer").mockReturnValue(false);

  const client = getQueryClient();
  client.setQueryData(["session"], { userId: "browser-user" });

  expect(getQueryClient()).toBe(client);
  expect(getQueryClient().getQueryData(["session"])).toEqual({
    userId: "browser-user",
  });
  expect(client.getDefaultOptions().queries?.staleTime).toBe(60_000);
  client.clear();
});
