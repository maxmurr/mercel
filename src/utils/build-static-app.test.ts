import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test, vi } from "vitest";
import { buildStaticApp } from "./build-static-app.ts";

test("buildStaticApp honors package-lock.json, runs npm build, and rejects failures", async ({
  onTestFinished,
}) => {
  // Spaces in the path prove commands never pass through a shell.
  const directoryPath = await mkdtemp(join(tmpdir(), "mercel static app "));
  onTestFinished(async () => {
    vi.unstubAllEnvs();
    await rm(directoryPath, { force: true, recursive: true });
  });
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("BUILD_WORKER_SECRET", "must-not-reach-build");
  await expect(buildStaticApp({ directoryPath })).rejects.toMatchObject({
    code: "ENOENT",
  });

  const packagePath = join(directoryPath, "package.json");
  const lockPath = join(directoryPath, "package-lock.json");
  const buildPath = join(directoryPath, "build.mjs");
  const distPath = join(directoryPath, "dist");
  await mkdir(join(directoryPath, "build-tool"));
  await writeFile(
    join(directoryPath, "build-tool", "package.json"),
    JSON.stringify({ main: "index.js", name: "build-tool", version: "1.0.0" })
  );
  await writeFile(
    join(directoryPath, "build-tool", "index.js"),
    'export const html = "<h1>Built</h1>";'
  );
  const packageJson = {
    devDependencies: { "build-tool": "file:./build-tool" },
    scripts: {
      build: "node build.mjs",
      postinstall:
        "node -e \"require('node:fs').writeFileSync('installed.txt', 'installed')\"",
    },
  };
  await writeFile(packagePath, JSON.stringify(packageJson));
  await expect(buildStaticApp({ directoryPath })).rejects.toMatchObject({
    code: "ENOENT",
  });
  await promisify(execFile)(
    "npm",
    [
      "install",
      "--package-lock-only",
      "--ignore-scripts",
      "--offline",
      "--no-audit",
    ],
    { cwd: directoryPath }
  );
  const lockContents = await readFile(lockPath, "utf8");
  await writeFile(
    buildPath,
    `import { mkdir, writeFile } from "node:fs/promises";
import { html } from "build-tool";
if (process.env.NODE_ENV !== "production" || process.env.BUILD_WORKER_SECRET) {
  throw new Error("Unexpected build environment");
}
await mkdir("dist/assets", { recursive: true });
await writeFile("dist/index.html", html);
await writeFile("dist/assets/app.js", "export default 1;");`
  );
  await mkdir(distPath);
  await writeFile(join(distPath, "stale.txt"), "discard");

  await buildStaticApp({ directoryPath });
  expect(await readFile(lockPath, "utf8")).toBe(lockContents);
  expect(await readFile(join(directoryPath, "installed.txt"), "utf8")).toBe(
    "installed"
  );
  expect(await readFile(join(distPath, "index.html"), "utf8")).toBe(
    "<h1>Built</h1>"
  );
  expect(await readFile(join(distPath, "assets", "app.js"), "utf8")).toBe(
    "export default 1;"
  );
  await expect(readFile(join(distPath, "stale.txt"))).rejects.toMatchObject({
    code: "ENOENT",
  });

  await writeFile(
    packagePath,
    JSON.stringify({
      ...packageJson,
      devDependencies: {
        ...packageJson.devDependencies,
        "another-build-tool": "file:./build-tool",
      },
    })
  );
  await expect(buildStaticApp({ directoryPath })).rejects.toThrow(
    "Command failed: npm ci --include=dev"
  );
  expect(await readFile(lockPath, "utf8")).toBe(lockContents);
  await writeFile(packagePath, JSON.stringify(packageJson));

  await writeFile(buildPath, "process.exit(2);");
  await expect(buildStaticApp({ directoryPath })).rejects.toThrow(
    "Command failed: npm run build"
  );
  await expect(readFile(join(distPath, "index.html"))).rejects.toMatchObject({
    code: "ENOENT",
  });

  await writeFile(buildPath, "process.exit(0);");
  await expect(buildStaticApp({ directoryPath })).rejects.toThrow(
    "Static app build did not produce dist/index.html."
  );

  await writeFile(
    buildPath,
    `import { mkdir, symlink, writeFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await writeFile("dist/home.html", "built");
await symlink("home.html", "dist/index.html");`
  );
  await expect(buildStaticApp({ directoryPath })).rejects.toThrow(
    "Static app build must produce dist/index.html as a regular file"
  );

  await writeFile(packagePath, "{invalid json");
  await expect(buildStaticApp({ directoryPath })).rejects.toThrow(
    "Command failed: npm ci --include=dev"
  );
});
