import { execFile } from "node:child_process";
import { access, lstat, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

/** Options for building a downloaded Vite + React static app. */
interface BuildStaticAppOptions {
  /**
   * The repository root containing package.json, package-lock.json, and a build script that writes dist/.
   * @example "output/deploy/abc12"
   */
  directoryPath: string;
}

/** Options for running an npm command in the downloaded repository. */
interface RunNpmCommandOptions {
  /** The npm command and flags, passed without a shell. */
  args: string[];
  /** The dependency installation or production build environment. */
  nodeEnv: "development" | "production";
}

const execFileAsync = promisify(execFile);
const BUILD_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const BUILD_OUTPUT_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Installs dependencies from package-lock.json with npm ci and builds a trusted static app, replacing any existing dist/.
 * Commands run on the worker host, not in a sandbox. Worker secrets are not passed in the environment.
 * @param options The downloaded repository directory.
 * @returns Resolves after the build produces dist/index.html.
 * @throws If package.json or package-lock.json is missing, install or build fails or times out, or dist/index.html is missing or not a regular file.
 * @example
 * await buildStaticApp({ directoryPath: "output/deploy/abc12" });
 */
export async function buildStaticApp({
  directoryPath,
}: BuildStaticAppOptions): Promise<void> {
  // Require repository-local manifests before npm can search parent directories.
  await access(join(directoryPath, "package.json"));
  await access(join(directoryPath, "package-lock.json"));
  /**
   * Runs npm in the downloaded repository with bounded output and execution time.
   * @param options The command arguments and Node environment.
   * @returns Resolves when npm exits successfully.
   * @throws If npm fails to start, exits unsuccessfully, or times out.
   * @example
   * await runNpmCommand({ args: ["run", "build"], nodeEnv: "production" });
   */
  const runNpmCommand = async ({
    args,
    nodeEnv,
  }: RunNpmCommandOptions): Promise<void> => {
    try {
      await execFileAsync("npm", args, {
        cwd: directoryPath,
        env: {
          CI: "true",
          HOME: process.env.HOME,
          NODE_ENV: nodeEnv,
          PATH: process.env.PATH,
          TMPDIR: process.env.TMPDIR,
        },
        maxBuffer: BUILD_OUTPUT_MAX_BYTES,
        timeout: BUILD_COMMAND_TIMEOUT_MS,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        "killed" in error &&
        error.killed === true
      ) {
        throw new Error(
          `npm ${args.join(" ")} timed out after ${BUILD_COMMAND_TIMEOUT_MS} ms.`,
          { cause: error }
        );
      }
      throw error;
    }
  };
  await runNpmCommand({
    args: ["ci", "--include=dev"],
    nodeEnv: "development",
  });
  await rm(join(directoryPath, "dist"), { force: true, recursive: true });
  await runNpmCommand({ args: ["run", "build"], nodeEnv: "production" });
  const indexStats = await lstat(
    join(directoryPath, "dist", "index.html")
  ).catch((error: unknown) => {
    throw new Error("Static app build did not produce dist/index.html.", {
      cause: error,
    });
  });
  // Symlinks are skipped on upload, so a linked index.html would complete with no entry point in S3.
  if (!indexStats.isFile()) {
    throw new Error(
      "Static app build must produce dist/index.html as a regular file, not a symlink or directory."
    );
  }
}
