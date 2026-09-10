# mercel

Bun and Turborepo workspace with three backend services, a Next.js web app, and
shared TypeScript packages.

```text
apps/
  upload-server/          # Elysia deployment API and Workbench, port 3000
  deploy-worker/          # BullMQ download, build, and upload worker
  request-handler-server/ # Elysia static file server, port 3001
  web/                    # Next.js App Router, port 3002
packages/
  db/                    # PostgreSQL client, schema, and Drizzle migrations
  utils/                 # IDs, file operations, S3, builds, and test helpers
```

Apps import shared code through `@repo/db/*` and `@repo/utils/*` exports.
The request handler only needs utils, not PostgreSQL or Redis. Packages export
TypeScript directly for Bun; no library build step or barrel files.
Shared dependency versions live in the root `package.json` catalog. Packages use
`catalog:` for those dependencies and `workspace:*` for internal packages.

## Run

Install [Bun](https://bun.sh/docs/installation) 1.4.0 or later and Git, then:

```sh
bun install
cp -n apps/upload-server/.env.example apps/upload-server/.env
cp -n apps/deploy-worker/.env.example apps/deploy-worker/.env
cp -n apps/request-handler-server/.env.example apps/request-handler-server/.env
cp -n packages/db/.env.example packages/db/.env
cp -n .env.compose.example .env.compose
openssl rand -hex 24
```

For source copies without `.git`, use `bun install --ignore-scripts` to skip
Git hook installation.

Set `WORKBENCH_PASS` in `apps/upload-server/.env` to the generated password.
Keep the database, Redis, and S3 settings consistent between services that use
them. Bun loads each app's `.env` from its package directory. Drizzle Kit loads
`packages/db/.env`; Docker Compose uses `.env.compose`. When migrating from the
single-package layout, move existing values into these files and archive the old
root `.env` so Bun does not inject it into every app.

Start local services, create the `mercel` bucket at `http://localhost:9001`, apply
migrations, then run all apps:

```sh
docker compose --env-file .env.compose up -d --wait
bun run db:migrate
bun run dev
```

`GET http://localhost:3000/` returns `Hello Elysia`.
Edit `apps/upload-server/src/upload-server.ts`; development mode restarts on changes.
Use `bun run dev:upload`, `bun run dev:deploy`, `bun run dev:request`, or
`bun run dev:web` to run one app. The web app runs at http://localhost:3002 and
requires Node.js 20.9 or later. See [apps/web/README.md](apps/web/README.md).
App scratch files now live under each app's `output/` directory, not
root `output/`; existing root scratch files are left untouched.

CORS allows all origins and handles `OPTIONS` preflight requests. Credentials are
disabled. Before enabling credentials, replace `origin: "*"` in
`apps/upload-server/src/upload-server.ts` with an explicit allowlist of trusted frontend origins.

## API docs

Open `http://localhost:3000/openapi` to test requests in Scalar. Select
`POST /deploy` and send a JSON body with a nonempty `repoUrl` string. It clones
the repository with `simple-git` into `output/upload/<id>` relative to the server's
working directory, lists its files, then uploads each file to `S3_BUCKET` using
keys `output/<id>/<relative-file-path>`, without a leading slash. Nested
paths and hidden files, including `.git`, are preserved; symlinks are skipped.
Configure `apps/upload-server/.env` using its `.env.example` and create the
bucket first.

After every S3 upload succeeds, the endpoint adds a `deploy` job to the BullMQ
`jobs` queue with data `{ "uploadId": "<id>" }` and job ID `<id>`. The upload server
and deploy worker persist deployment status in PostgreSQL's `deployments` table.
BullMQ still manages queue execution and the Workbench dashboard.

The endpoint returns `200` with `{ "id": "<id>" }` only after the queue publish
succeeds. Database, clone, file-scan, upload, or Redis failures return `500` with the
generated `id`; files already uploaded remain in S3. Invalid request bodies
return `422` before an ID is generated. The OpenAPI JSON spec is at `/openapi/json`.

### Poll upload status

Use the `id` returned by `/deploy`:

```http
GET /status?id=abc12
```

```json
{ "status": "waiting" }
```

Every poll reads PostgreSQL, not Redis. Responses include `Cache-Control: no-store`.
The upload server records `cloning`, then `uploading`, then `waiting` before
publishing the job. The worker records `active` when each attempt starts and
`completed` only after every built file uploads. Either process records `failed`
when its work fails, including failures before a job exists. A failure only
records `failed` while the row still shows that attempt's status, so a stalled
attempt cannot overwrite a newer one. Retried jobs stay `failed` until the worker
starts the next attempt and records `active`.

Status survives BullMQ job removal. Existing jobs without a database row gain one
when the worker processes them; completed historical jobs are not backfilled.
Writes are awaited, but PostgreSQL and Redis do not share a transaction. A process
crash or failed database write can leave the last recorded status unchanged.

Missing or malformed IDs return `422`. IDs must contain five letters or digits,
matching `/deploy`. IDs without a database row return `404` with
`{ "message": "Upload not found" }`.
Database read failures return `503` with `{ "message": "Upload status unavailable" }`.
Redis read failures do not affect polling.

## Request logging

`apps/upload-server/src/upload-server.ts` initializes evlog with service name `mercel-upload-server`
and registers `evlog()` before other plugins and routes. Requests emit a wide
event with method,
path, status, duration, and request ID. Output is pretty-printed in development
and JSON when `NODE_ENV=production`.

`POST /deploy` logs `action: "deploy"`, the generated `id`, and its final `stage`:
`clone`, `scan`, `upload`, `publish`, or `complete`. After scanning, `fileCount`
records the number of files. `uploadedCount` and `uploadedBytes` count only
successful uploads, including when a later upload or queue publish fails.
Upload failures also include `currentKey`, the failed S3 object key.

Submitted repository URLs and full file lists are not logged. Redaction runs in
all environments before console output or drains, masking `repoUrl` fields and
URL, query, and fragment text in errors and other log strings. Startup emits a
structured `server_start` event with `hostname` and `port`.

Helpers called during a request can access the same logger without passing route
context:

```ts
import { useLogger } from "evlog/elysia";

// Call inside a request handler or a helper it invokes.
useLogger().set({ action: "deploy" });
```

`useLogger()` requires an active request context. For startup or queue workers,
use `log` from `evlog` instead. No external drain is configured. Add `drain`,
`enrich`, `include`, or `keep` options to `evlog()` when needed.

[Elysia logging docs](https://www.evlog.dev/integrate/frameworks/elysia) and
[drain adapters](https://www.evlog.dev/integrate/adapters/overview).

## Workbench

Open `http://localhost:3000/jobs` and sign in with `WORKBENCH_USER` and
`WORKBENCH_PASS` from `apps/upload-server/.env`. Startup fails if either credential or `REDIS_URL`
is missing. Use HTTPS outside local development; HTTP basic auth does not encrypt
credentials.

`apps/upload-server/src/upload-server.ts` connects a shared Redis publisher using `REDIS_URL`
before listening. The BullMQ `jobs` queue uses that connection through its node-redis
adapter. Commands reject while disconnected instead of waiting in an offline
queue. `/deploy` jobs appear in Workbench at `/jobs`. The mount path and `basePath`
are both `/jobs`, so dashboard assets and API requests stay under that path.

Add application queues to the mount's `queues` array as needed. To run only the
deploy worker, use `bun run dev:deploy` or `bun run start:deploy`.
It uses the same `DATABASE_URL`, `REDIS_URL`, `S3_BUCKET`, and AWS settings as the
upload server. Both processes require `DATABASE_URL` and the database migrations.

`apps/deploy-worker/src/deploy-worker.ts` runs without an HTTP listener. It logs `worker_start` when
Redis is ready. On `SIGINT` or `SIGTERM`, it logs `worker_stopping`, stops taking
jobs, waits for active jobs to finish, and closes its PostgreSQL pool before exiting.

The deploy worker consumes `deploy` jobs from `jobs`, including jobs queued while
it was offline. For each `{ "uploadId": "<id>" }`, it downloads `output/<id>/`
from S3 into `output/deploy/<id>` relative to its working directory, preserving
nested paths. IDs must contain five letters or digits. Each attempt clears that
job's local directory first, so retries restart partial downloads and builds.

After downloading, the worker calls `buildApp({ directoryPath, preset: "vite" })`
from `@repo/utils/build-app`. The required `preset` option currently supports
only `"vite"`; unsupported presets fail before any install or build runs.
The Vite preset expects a static app with a root `package.json`,
`package-lock.json`, and a `build` script that writes `dist/`.
Install Node.js and npm on the worker host. Mercel still runs on Bun, but downloaded
apps use `npm ci --include=dev` with `NODE_ENV=development`, then `npm run build`
with `NODE_ENV=production`. Missing or mismatched lockfiles fail the job; npm does
not regenerate them. Install lifecycle scripts run normally.
Each command has a five-minute timeout.
Any existing `dist/` is removed before building. The worker uploads files from
`output/deploy/<id>/dist/` to `S3_BUCKET` using keys `dist/<id>/<relative-file-path>`.
Nested paths and hidden files are preserved; symlinks are skipped. Local build
files remain on disk. The worker does not serve them.

BullMQ marks the job `completed` only after the build produces `dist/index.html`
as a regular file and every upload succeeds. Download, install, build,
missing-output, or upload errors mark it `failed`. Files already uploaded remain
in S3; retries overwrite matching keys but do not delete other objects under
`dist/<id>/`.
Completion logs include `action: "deploy_completed"`, `jobId`, and the downloaded
`fileCount`; failure logs include `action: "deploy_failed"`, `jobId`, and the error.

Only build trusted repositories. Install and build scripts execute on the worker host with
its filesystem and network access. The child environment passes only `HOME`,
`PATH`, `TMPDIR`, `CI`, and `NODE_ENV`, but this is not a sandbox. Isolate builds
before accepting untrusted repositories.

[Elysia integration docs](https://getworkbench.dev/docs/frameworks/elysia).

## Database

Drizzle uses Bun's native PostgreSQL driver. Set `DATABASE_URL` in
`packages/db/.env` for database commands and in each consuming app's `.env`, then
start PostgreSQL:

```sh
docker compose --env-file .env.compose up -d --wait postgres
```

Import `postgresDb` from `@repo/db/database` for queries. It shares a connection
pool and connects on the first query. Importing it fails if `DATABASE_URL` is
missing. Standalone scripts should call `await postgresDb.$client.close()` when
finished.

Define and export tables in `packages/db/src/schema.ts` using `drizzle-orm/pg-core`.
Apps import them from `@repo/db/schema`.
The `deployments` table stores each deployment ID and its status. Apply the
committed migration before starting the upload server or worker. After changing
the schema:

```sh
bun run db:generate  # Generate SQL migrations in packages/db/drizzle/
bun run db:migrate   # Apply pending migrations
bun run db:studio    # Browse the database locally
```

Review generated SQL before applying it and commit `packages/db/drizzle/`.
For local schema experiments, `bun run db:push` applies changes without migration
files. Use migrations for shared databases. Turbo runs database commands inside
`packages/db`, under Bun, loading that package's `.env`. Schema-changing commands
are never cached. Drizzle Kit uses the `postgres` dev dependency; application
queries use Bun's native driver. No dotenv package is needed.

## Local services

Start PostgreSQL, Redis, and RustFS with Docker Compose:

```sh
docker compose --env-file .env.compose up -d --wait
```

- PostgreSQL: `localhost:5432`, database and user `mercel`
- Redis: `redis://localhost:6379`
- RustFS S3 endpoint: `http://localhost:9000`
- RustFS console: `http://localhost:9001`
- RustFS access key: `mercel-local`
- RustFS secret key: `mercel-local-secret`

These credentials are for local development only. Override `RUSTFS_ACCESS_KEY`
and `RUSTFS_SECRET_KEY` in `.env.compose` if needed. Ports bind only to localhost.
Create buckets through the RustFS console; use path-style addressing in S3 clients.

```sh
docker compose --env-file .env.compose down
```

Stopping services preserves PostgreSQL, Redis, and object data in named Docker volumes.
Redis uses append-only persistence and disables key eviction for queue workloads.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```text
feat: add upload retries
fix(storage): handle empty files
chore: update dependencies
```

`bun install` installs a Lefthook `commit-msg` hook that validates messages with
commitlint's conventional preset. Allowed types are `build`, `chore`, `ci`,
`docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, and `test`.
Scope is optional. Use a lowercase subject without a trailing period.

Check a message without creating a commit:

```sh
printf '%s\n' 'feat: add upload retries' | bun run lint:commit
```

## Commands

```sh
bun run start       # Run all three apps without watching
bun run build       # Emit each app entrypoint into its dist/ directory
bun run typecheck   # Check TypeScript in every package
bun run test        # Run each package's Vitest suite; requires Docker
bun run test:watch  # Watch each package's tests
bun run check       # Check packages and root tooling config
bun run fix         # Fix packages and root tooling config
PORT=4000 bun run dev:upload
bun run test --filter=@repo/utils
bun run build --filter=@repo/upload-server
```

Root scripts delegate package tasks to `turbo run`. Package scripts own their
commands. Root lint/fix tasks cover only root tooling files; Git hooks and
commitlint remain repository-wide tools. Typechecks use transit tasks so shared
source changes invalidate dependent caches without serializing the checks.
Tests are uncached because integration suites use Docker and external tools.
Turbo passes runtime variables only to apps that need them; build output does
not inline environment variables.

Bun runs TypeScript directly, so dev and start need no build. Optional builds
emit JavaScript with external package imports; keep workspace packages and
installed dependencies available when running `bun dist/<app-name>.js` from an
app directory. Build artifacts are not standalone bundles.

Use explicit `.ts` extensions in local imports and extensionless exported
subpaths for workspace imports. Each package runs the shared `vitest.config.ts`
against its own `src/**/*.test.ts`; cloned repositories under `output/` fall
outside that glob.
Use `bun run test`, not `bun test`, which invokes Bun's own test runner.
Tool scripts use `--bun` to run under Bun rather than Node.js.

Upload and worker integration tests start isolated `redis:8-alpine` and
`postgres:18-alpine` Docker containers on random localhost ports, apply the
committed database migrations, and remove the containers afterward. They use a
local HTTP S3 stub and never connect to the services in app `.env` files.

For CI, make Docker available, install with `bun install --frozen-lockfile`, then
run `bun run typecheck` and `bun run test`.
