// @vitest-environment node

import { expect, it } from "vitest";
import {
  existingThreadSandbox,
  threadSandbox,
  threadWorkspaceDir,
} from "./thread-workspace";

const threadA = "11111111-1111-4111-8111-111111111111";
const threadB = "22222222-2222-4222-8222-222222222222";
const invalidThreadId = /Invalid thread ID/;

it("keeps each thread in its own directory", () => {
  expect(threadWorkspaceDir(threadA)).toBe(`.sandbox/${threadA}`);
  expect(threadWorkspaceDir(threadB)).not.toBe(threadWorkspaceDir(threadA));
});

it("refuses a thread ID that would escape the sandbox root", () => {
  for (const threadId of ["..", "../../etc", `${threadA}/../..`, "", "."]) {
    expect(() => threadWorkspaceDir(threadId)).toThrow(invalidThreadId);
  }
});

it("reuses one sandbox per thread and never shares it across threads", () => {
  const sandboxA = threadSandbox(threadA);

  expect(threadSandbox(threadA)).toBe(sandboxA);
  expect(threadSandbox(threadB)).not.toBe(sandboxA);
  expect(existingThreadSandbox(threadA)).toBe(sandboxA);
});

it("reports no sandbox for a thread that has not run anything", () => {
  expect(
    existingThreadSandbox("33333333-3333-4333-8333-333333333333")
  ).toBeUndefined();
});
