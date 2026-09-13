// @vitest-environment node

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  existingThreadSandbox,
  sandboxIdleTtlMs,
  stopIdleThreadSandboxes,
  threadSandbox,
  threadWorkspaceDir,
} from "./thread-workspace";

const threadA = "11111111-1111-4111-8111-111111111111";
const threadB = "22222222-2222-4222-8222-222222222222";
const threadC = "44444444-4444-4444-8444-444444444444";
const threadD = "55555555-5555-4555-8555-555555555555";
const threadE = "66666666-6666-4666-8666-666666666666";
const threadF = "77777777-7777-4777-8777-777777777777";
const invalidThreadId = /Invalid thread ID/;

// Each test runs in its own cwd holding a stub starter, so seeding never touches the real .sandbox.
const originalCwd = process.cwd();
let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "mercel-workspace-"));
  const template = join(cwd, "templates/vite-react");
  mkdirSync(join(template, "src"), { recursive: true });
  mkdirSync(join(template, "node_modules/left-pad"), { recursive: true });
  writeFileSync(join(template, "src/App.tsx"), "export default () => null;\n");
  writeFileSync(join(template, "node_modules/left-pad/index.js"), "");
  process.chdir(cwd);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  process.chdir(originalCwd);
  rmSync(cwd, { force: true, recursive: true });
});

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

it("keeps sandbox dev dependencies enabled when the server runs in production", () => {
  vi.stubEnv("NODE_ENV", "production");
  const sandbox = threadSandbox("88888888-8888-4888-8888-888888888888");

  expect(sandbox.buildEnv().NODE_ENV).toBe("development");
});

it("reports no sandbox for a thread that has not run anything", () => {
  expect(
    existingThreadSandbox("33333333-3333-4333-8333-333333333333")
  ).toBeUndefined();
});

it("seeds a new thread from the starter without its node_modules", () => {
  threadSandbox(threadC);

  const threadDir = join(cwd, ".sandbox", threadC);
  expect(existsSync(join(threadDir, "src/App.tsx"))).toBe(true);
  expect(existsSync(join(threadDir, "node_modules"))).toBe(false);
});

it("destroys and forgets a sandbox once no turn has used it for the TTL", () => {
  vi.useFakeTimers();
  const createdAt = Date.now();
  const sandbox = threadSandbox(threadE);

  stopIdleThreadSandboxes(createdAt + sandboxIdleTtlMs - 1);
  expect(existingThreadSandbox(threadE)).toBe(sandbox);

  stopIdleThreadSandboxes(createdAt + sandboxIdleTtlMs);
  expect(existingThreadSandbox(threadE)).toBeUndefined();
  expect(sandbox.status).toBe("destroyed");
  expect(threadSandbox(threadE)).not.toBe(sandbox);
});

it("counts each turn as use, so the TTL runs from the last one", () => {
  vi.useFakeTimers();
  const createdAt = Date.now();
  const sandbox = threadSandbox(threadF);

  vi.setSystemTime(createdAt + sandboxIdleTtlMs - 1);
  threadSandbox(threadF);
  stopIdleThreadSandboxes(createdAt + sandboxIdleTtlMs);

  expect(existingThreadSandbox(threadF)).toBe(sandbox);
});

it("leaves a thread directory that already exists untouched", () => {
  const ownFile = join(cwd, ".sandbox", threadD, "own.txt");
  mkdirSync(dirname(ownFile), { recursive: true });
  writeFileSync(ownFile, "mine");

  threadSandbox(threadD);

  expect(existsSync(ownFile)).toBe(true);
  expect(existsSync(join(cwd, ".sandbox", threadD, "src/App.tsx"))).toBe(false);
});
