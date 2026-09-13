# Upload server

## Docker

Build from the repository root so Turbo can prune the workspace dependencies:

```sh
docker build -f apps/upload-server/Dockerfile -t mercel-upload-server .
```

The image uses Bun 1.4.2, installs locked production dependencies, and runs
TypeScript directly as the non-root `bun` user. It includes `tar` and `gzip` for
archive extraction. `Dockerfile.dockerignore` keeps `.env` files, dependency
folders, tests, and local output out of the build context.

Copy `.env.example` to `.env.docker` in this directory and configure it for the
container. Provide `DATABASE_URL`, `REDIS_URL`, `DEPLOY_TOKEN`, `WORKBENCH_USER`,
`WORKBENCH_PASS`, `S3_BUCKET`, `AWS_REGION`, and AWS credentials or a workload role.
Set `S3_ENDPOINT` for S3-compatible storage. Use the same `DEPLOY_TOKEN` in the
web client. Keep secrets in runtime environment variables, never build arguments.

```sh
docker run --rm --name mercel-upload-server \
  --env-file apps/upload-server/.env.docker \
  -e PORT=3000 -p 127.0.0.1:3000:3000 \
  mercel-upload-server
```

PostgreSQL, Redis, S3, and the deploy worker run separately. Apply database
migrations and create the S3 bucket before sending uploads. See the
[root README](../../README.md) and [infrastructure setup](../../infra/README.md).

`localhost` inside the container refers to the container, not the host. Use
service DNS names on a shared Docker network and add `--network <network>` to
`docker run`. For host services on Docker Desktop, replace `localhost` or
`127.0.0.1` in connection URLs with `host.docker.internal`. On Linux Docker Engine,
also add `--add-host=host.docker.internal:host-gateway` and make sure the services
listen on an address reachable from Docker.

Smoke check from another terminal:

```sh
curl --fail http://localhost:3000/
docker inspect --format '{{.State.Health.Status}}' mercel-upload-server
```

The response is `Hello Elysia`; Docker health becomes `healthy` after its first
probe. The probe checks HTTP liveness, not PostgreSQL or S3 availability.
`/jobs` requires Workbench credentials, and `POST /deploy` requires
`Authorization: Bearer <DEPLOY_TOKEN>`. Use HTTPS before exposing either endpoint
outside local development.

Extracted uploads live in `/app/apps/upload-server/output/upload` and disappear
when the container is removed. S3 holds uploaded files; no persistent volume is
required. Files accumulate while the container runs, so monitor its writable-layer
disk usage. Any mounted output directory must be writable by `bun`, UID 1000.
