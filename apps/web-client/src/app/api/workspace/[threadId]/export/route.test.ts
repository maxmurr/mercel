// @vitest-environment node

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET } from "./route";

const signedInUserId = "user-1";
let sessionUserId: string | undefined = signedInUserId;

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: () =>
        Promise.resolve(sessionUserId ? { user: { id: sessionUserId } } : null),
    },
  },
}));

const threadId = "99999999-9999-4999-8999-999999999999";

// Each test runs in its own cwd so exporting never reads the real .sandbox.
const originalCwd = process.cwd();
let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "mercel-export-"));
  process.chdir(cwd);
});

afterEach(() => {
  sessionUserId = signedInUserId;
  process.chdir(originalCwd);
  rmSync(cwd, { force: true, recursive: true });
});

function exportWorkspace() {
  return GET(
    new Request(`http://localhost:3002/api/workspace/${threadId}/export`),
    { params: Promise.resolve({ threadId }) }
  );
}

function writeThreadFiles(files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    const file = join(cwd, ".sandbox", threadId, path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, content);
  }
}

it("refuses to export without a session", async () => {
  sessionUserId = undefined;
  expect((await exportWorkspace()).status).toBe(401);
});

it("reports a thread that has no files yet", async () => {
  const response = await exportWorkspace();
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Nothing to export yet" });
});

it("downloads the thread's files as a zip without node_modules or dist", async () => {
  writeThreadFiles({
    "dist/index.html": "<!doctype html>",
    "index.html": "<!doctype html>",
    "node_modules/left-pad/index.js": "",
    "src/main.ts": "export {};\n",
  });

  const response = await exportWorkspace();

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("application/zip");
  expect(response.headers.get("Content-Disposition")).toBe(
    'attachment; filename="project.zip"'
  );
  const zip = join(cwd, "downloaded.zip");
  writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
  const members = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" });
  expect(members.split("\n").filter(Boolean).sort()).toEqual([
    "index.html",
    "src/",
    "src/main.ts",
  ]);
});
