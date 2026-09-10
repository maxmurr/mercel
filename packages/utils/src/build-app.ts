import { execFile } from "node:child_process";
import { access, lstat, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

/** Options for building a downloaded static app. */
interface BuildAppOptions {
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
/** Debian-based so native dependencies build; Alpine's musl breaks some packages. */
const BUILD_IMAGE = "node:24-bookworm-slim";
const BUILD_MEMORY_LIMIT = "2g";
const BUILD_PROCESS_LIMIT = "512";
const BUILD_TMPFS_SIZE = "1g";
const CONTAINER_NAME_INVALID_CHARACTERS = /[^\w.-]/g;

const exitCodeOf = (error: unknown): unknown =>
  error instanceof Error && "code" in error ? error.code : undefined;

/**
 * Builds a static app with npm ci and npm run build inside a throwaway Docker container, replacing any existing dist/.
 * The repository is bind-mounted at /app; the container runs as the worker's user with no worker environment,
 * a read-only root filesystem, dropped capabilities, and memory and process limits. Network egress stays open for the npm registry.
 * @param options The downloaded repository directory.
 * @returns Resolves after the build produces dist/index.html.
 * @throws If package.json or package-lock.json is missing, Docker is unavailable, install or build fails or times out, or dist/index.html is missing or not a regular file. Failed commands keep the npm or Docker exit code in `code`.
 * @example
 * await buildApp({ directoryPath: "output/deploy/abc12" });
 */
export async function buildApp({
  directoryPath,
}: BuildAppOptions): Promise<void> {
  // Require repository-local manifests before npm can search parent directories.
  await access(join(directoryPath, "package.json"));
  await access(join(directoryPath, "package-lock.json"));
  const { getgid, getuid } = process;
  if (!(getuid && getgid)) {
    throw new Error("Container builds require a POSIX host user ID.");
  }
  const containerName = `mercel-build-${basename(directoryPath).replace(
    CONTAINER_NAME_INVALID_CHARACTERS,
    "-"
  )}`;
  // Idempotent: exits 0 when the container is already gone; swallow the race with --rm removal.
  const removeContainer = () =>
    execFileAsync("docker", ["rm", "--force", containerName]).catch(
      () => undefined
    );
  /**
   * Runs npm in the container with bounded output and execution time.
   * @param options The command arguments and Node environment.
   * @returns Resolves when npm exits successfully.
   * @throws If Docker or npm fails to start, exits unsuccessfully, or times out.
   * @example
   * await runNpmCommand({ args: ["run", "build"], nodeEnv: "production" });
   */
  const runNpmCommand = async ({
    args,
    nodeEnv,
  }: RunNpmCommandOptions): Promise<void> => {
    const command = `npm ${args.join(" ")}`;
    try {
      await execFileAsync(
        "docker",
        [
          "run",
          "--rm",
          "--name",
          containerName,
          "--user",
          `${getuid()}:${getgid()}`,
          "--volume",
          `${resolve(directoryPath)}:/app`,
          "--workdir",
          "/app",
          "--read-only",
          "--tmpfs",
          `/tmp:rw,size=${BUILD_TMPFS_SIZE}`,
          "--env",
          "HOME=/tmp",
          "--env",
          "npm_config_cache=/tmp/.npm",
          "--env",
          "CI=true",
          "--env",
          `NODE_ENV=${nodeEnv}`,
          "--memory",
          BUILD_MEMORY_LIMIT,
          "--pids-limit",
          BUILD_PROCESS_LIMIT,
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          BUILD_IMAGE,
          "npm",
          ...args,
        ],
        {
          // SIGTERM would only be forwarded into the container and block until npm exits; SIGKILL returns at once and finally removes the container.
          killSignal: "SIGKILL",
          maxBuffer: BUILD_OUTPUT_MAX_BYTES,
          timeout: BUILD_COMMAND_TIMEOUT_MS,
        }
      );
    } catch (error) {
      if (
        error instanceof Error &&
        "killed" in error &&
        error.killed === true
      ) {
        throw new Error(
          `${command} timed out after ${BUILD_COMMAND_TIMEOUT_MS} ms.`,
          { cause: error }
        );
      }
      throw Object.assign(new Error(`${command} failed.`, { cause: error }), {
        code: exitCodeOf(error),
      });
    } finally {
      await removeContainer();
    }
  };
  // A worker killed mid-build leaves its container running; clear it before reusing the name.
  await removeContainer();
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
