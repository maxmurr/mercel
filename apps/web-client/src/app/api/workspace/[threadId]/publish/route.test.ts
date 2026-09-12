// @vitest-environment node

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mastra } from "@/mastra";
import { POST } from "./route";

const signedInUserId = "user-1";
let sessionUserId: string | undefined = signedInUserId;

vi.mock("@/features/user/user-auth", () => ({
  auth: {
    api: {
      getSession: () =>
        Promise.resolve(sessionUserId ? { user: { id: sessionUserId } } : null),
    },
  },
}));

const threadId = "88888888-8888-4888-8888-888888888888";
const fetchMock = vi.fn<typeof fetch>();

// Each test runs in its own cwd so archiving never reads the real .sandbox.
const originalCwd = process.cwd();
let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "mercel-publish-"));
  process.chdir(cwd);
  vi.stubEnv("OPENCODE_API_KEY", "test-key");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  sessionUserId = signedInUserId;
  process.chdir(originalCwd);
  rmSync(cwd, { force: true, recursive: true });
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function publish() {
  return POST(
    new Request(`http://localhost:3002/api/workspace/${threadId}/publish`, {
      method: "POST",
    }),
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

it("refuses to publish without a session", async () => {
  sessionUserId = undefined;
  const response = await publish();
  expect(response.status).toBe(401);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("reports a thread that has no files yet", async () => {
  const response = await publish();
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Nothing to publish yet" });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("archives the thread's files without node_modules or dist and starts a deployment", async () => {
  writeThreadFiles({
    "dist/index.html": "<!doctype html>",
    "index.html": "<!doctype html>",
    "node_modules/left-pad/index.js": "",
    "src/main.ts": "export {};\n",
  });
  fetchMock.mockResolvedValue(Response.json({ id: "abc12" }));

  const response = await publish();

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id: "abc12" });
  const [url, init] = fetchMock.mock.calls[0] ?? [];
  expect(String(url)).toBe("http://localhost:3000/deploy");
  expect(init?.method).toBe("POST");
  const archive =
    init?.body instanceof FormData ? init.body.get("archive") : undefined;
  if (!(archive instanceof Blob)) {
    throw new Error("Deployment archive is not a file.");
  }
  const members = execFileSync("tar", ["-tz"], {
    encoding: "utf8",
    input: Buffer.from(await archive.arrayBuffer()),
  });
  expect(members.split("\n").filter(Boolean).sort()).toEqual([
    "./",
    "./index.html",
    "./src/",
    "./src/main.ts",
  ]);
});

it("passes the upload server's refusal back to the browser", async () => {
  writeThreadFiles({ "index.html": "<!doctype html>" });
  fetchMock.mockResolvedValue(Response.json({ id: "abc12" }, { status: 500 }));

  const response = await publish();

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: "Deployment could not be started (HTTP 500).",
  });
});

it("republishes the thread's deployment in place so its URL keeps working", async () => {
  writeThreadFiles({ "index.html": "<!doctype html>" });
  fetchMock.mockResolvedValue(Response.json({ id: "abc12" }));
  const memory = await mastra.getAgentById("agent").getMemory();
  if (!memory) {
    throw new Error("Agent has no memory.");
  }
  await memory.createThread({
    metadata: { deploymentId: "abc12" },
    resourceId: signedInUserId,
    threadId,
  });

  expect((await publish()).status).toBe(200);

  const [, init] = fetchMock.mock.calls[0] ?? [];
  const body = init?.body instanceof FormData ? init.body : undefined;
  expect(body?.get("id")).toBe("abc12");
});

it("remembers the deployment on the thread so the site reopens later", async () => {
  writeThreadFiles({ "index.html": "<!doctype html>" });
  fetchMock.mockResolvedValue(Response.json({ id: "abc12" }));
  const memory = await mastra.getAgentById("agent").getMemory();
  if (!memory) {
    throw new Error("Agent has no memory.");
  }
  await memory.createThread({ resourceId: signedInUserId, threadId });

  expect((await publish()).status).toBe(200);

  const thread = await memory.getThreadById({ threadId });
  expect(thread?.metadata?.deploymentId).toBe("abc12");
});
