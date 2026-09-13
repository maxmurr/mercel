# Deploy worker in Docker

Run commands from the repository root. Requires a local Docker daemon, reachable
PostgreSQL and Redis, an S3 bucket, and applied database migrations. No HTTP port
or HTTP health check: the worker logs `worker_start` when Redis is ready.

## Build

```sh
docker build -f apps/deploy-worker/Dockerfile -t mercel-deploy-worker .
docker pull node:24-bookworm-slim
```

Turbo prunes to `deploy-worker`, `@repo/db`, and `@repo/utils`. Bun installs frozen
production dependencies without lifecycle scripts, then runs TypeScript directly,
matching the package's `start` script. The image includes Docker CLI, not a Docker
daemon or npm. `Dockerfile.dockerignore` excludes secrets, local dependencies,
build output, scratch files, and tests from the build context.

## Run

Create a container-specific environment file without changing local dev settings:

```sh
cp -n apps/deploy-worker/.env.example apps/deploy-worker/.env.docker
```

Set `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `AWS_REGION`,
`AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` in that file. Supply
`AWS_SESSION_TOKEN` too when using temporary credentials. Use addresses reachable
from the container. `127.0.0.1` refers to the container, not the host.

For Docker Desktop with the existing k3d port-forwards, replace `127.0.0.1` in
those URLs with `host.docker.internal`. On native Linux, add `--network host` to
the run command to reach host loopback port-forwards. For services in another
Docker network, use `--network <name>` and their service names instead.

The worker launches sibling build containers through the host Docker socket.
**Socket access grants control over the host daemon, even when the worker runs
as non-root.** Use a dedicated, trusted build host. Do not expose its Docker API
or use this setup for hostile tenant code. Build containers do not receive the
socket or worker credentials, but still share the host kernel and have network
access.

```sh
# Only scratch files go here, never source code or credentials.
mkdir -p apps/deploy-worker/output/docker
work_dir="$(cd apps/deploy-worker/output/docker && pwd -P)"
docker_socket="/var/run/docker.sock"

# Read the socket group inside Docker; works on Linux and Docker Desktop.
docker_group="$(docker run --rm \
  --mount "type=bind,source=$docker_socket,target=/var/run/docker.sock" \
  mercel-deploy-worker stat -c '%g' /var/run/docker.sock)"

docker run --detach --name mercel-deploy-worker \
  --init --stop-timeout 660 \
  --user "$(id -u):$(id -g)" --group-add "$docker_group" \
  --env-file apps/deploy-worker/.env.docker \
  --mount "type=bind,source=$docker_socket,target=/var/run/docker.sock" \
  --mount "type=bind,source=$work_dir,target=$work_dir" \
  --workdir "$work_dir" \
  mercel-deploy-worker

docker logs --follow mercel-deploy-worker
```

Change `docker_socket` for a non-default local socket. Run as a non-root host
user so downloaded files and build processes use that user's UID/GID. The image
defaults to user `bun`; the override above keeps host scratch files writable.

Keep the scratch directory at the **same absolute path on host and worker**.
`buildApp` passes that path to the host daemon for each `/app` bind mount. A named
volume or a bind mount at a different container path will not work. This recipe
assumes the daemon can access the local scratch directory, not a remote daemon.
Build files remain under `$work_dir/output/deploy/`; clean them while the worker
is stopped and monitor disk usage.

```sh
docker stop --time 660 mercel-deploy-worker
docker rm mercel-deploy-worker
```

`SIGTERM` drains the active job before closing PostgreSQL. The 660-second grace
period allows both five-minute build commands plus transfer time. Increase it
for large downloads/uploads; Docker force-kills the worker after this deadline.

## Verify Docker builds

After defining `work_dir`, `docker_socket`, and `docker_group` above, this smoke
check builds a dependency-free fixture through the image's Docker CLI. It needs
no database, Redis, or S3 credentials. Run while the worker is stopped.

```sh
docker run --rm --init \
  --user "$(id -u):$(id -g)" --group-add "$docker_group" \
  --mount "type=bind,source=$docker_socket,target=/var/run/docker.sock" \
  --mount "type=bind,source=$work_dir,target=$work_dir" \
  --workdir "$work_dir" \
  mercel-deploy-worker bun -e '
    import assert from "node:assert/strict";
    import { mkdtemp, rm } from "node:fs/promises";
    import { buildApp } from "/app/packages/utils/src/build-app.ts";
    const directoryPath = await mkdtemp(`${process.cwd()}/smoke-`);
    try {
      await Bun.write(`${directoryPath}/package.json`, JSON.stringify({
        scripts: { build: "mkdir -p dist && echo built > dist/index.html" }
      }));
      await Bun.write(`${directoryPath}/package-lock.json`, JSON.stringify({
        lockfileVersion: 3, packages: { "": {} }
      }));
      await buildApp({ directoryPath });
      assert.equal(await Bun.file(`${directoryPath}/dist/index.html`).text(), "built\n");
    } finally {
      await rm(directoryPath, { recursive: true, force: true });
    }
  '
```
