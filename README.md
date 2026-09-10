# mercel

TypeScript server using Elysia on Bun, with Vitest for testing.

## Run

Install [Bun](https://bun.sh/docs/installation) 1.4.0 or later and Git, then:

```sh
bun install
cp -n .env.example .env
openssl rand -hex 24
```

For source copies without `.git`, use `bun install --ignore-scripts` to skip
Git hook installation.

Set `WORKBENCH_PASS` in `.env` to the generated password. Keep any existing `.env`
values you need. The dev and start scripts load `.env` when present. Start Redis,
then the app:

```sh
docker compose up -d --wait redis
bun run dev
```

`GET http://localhost:3000/` returns `Hello Elysia`.
Edit `src/server.ts`; development mode restarts on changes.

CORS allows all origins and handles `OPTIONS` preflight requests. Credentials are
disabled. Before enabling credentials, replace `origin: "*"` in `src/server.ts`
with an explicit allowlist of trusted frontend origins.

## API docs

Open `http://localhost:3000/openapi` to test requests in Scalar. Select
`POST /deploy` and send a JSON body with a nonempty `repoUrl` string. It clones
the repository with `simple-git` into `output/<id>` relative to the server's
working directory, lists its files, then uploads each file to `S3_BUCKET` using
keys `/output/<id>/<relative-file-path>`, including the leading slash. Nested
paths and hidden files, including `.git`, are preserved; symlinks are skipped.
Configure `.env` using the S3 and AWS settings in `.env.example` and create the
bucket first.

After every S3 upload succeeds, the endpoint adds a `deploy` job to the BullMQ
`jobs` queue with data `{ "uploadId": "<id>" }` and job ID `<id>`. BullMQ owns the
job status; there is no separate application status hash.

The endpoint returns `200` with `{ "id": "<id>" }` only after the queue publish
succeeds. Clone, file-scan, upload, or Redis failures return `500` with the
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

Every poll loads the job by ID and calls BullMQ's `job.getState()`, reading the
current state from Redis. Responses include `Cache-Control: no-store`. States
include `waiting`, `active`, `completed`, and `failed`; there is no `uploaded`
state. BullMQ updates these states as workers process jobs.

Completed and failed jobs remain available for polling until removed. If job
retention or automatic removal is configured later, removed jobs return `404`.

Missing or malformed IDs return `422`. IDs must contain five letters or digits,
matching `/deploy`. Unknown or removed IDs return `404` with
`{ "message": "Upload not found" }`.
Redis read failures return `503` with `{ "message": "Upload status unavailable" }`.

## Request logging

`src/server.ts` initializes evlog with service name `my-api` and registers
`evlog()` before other plugins and routes. Requests emit a wide event with method,
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
`WORKBENCH_PASS` from `.env`. Startup fails if either credential or `REDIS_URL`
is missing. Use HTTPS outside local development; HTTP basic auth does not encrypt
credentials.

`src/server.ts` connects a shared Redis publisher using `REDIS_URL` before
listening. The BullMQ `jobs` queue uses that connection through its node-redis
adapter. Commands reject while disconnected instead of waiting in an offline
queue. `/deploy` jobs appear in Workbench at `/jobs`. The mount path and `basePath`
are both `/jobs`, so dashboard assets and API requests stay under that path.

Add application queues to the mount's `queues` array as needed. No worker is
configured yet; queued jobs wait until a BullMQ worker processes them.

[Elysia integration docs](https://getworkbench.dev/docs/frameworks/elysia).

## Local services

Start Redis and RustFS with Docker Compose:

```sh
docker compose up -d --wait
```

- Redis: `redis://localhost:6379`
- RustFS S3 endpoint: `http://localhost:9000`
- RustFS console: `http://localhost:9001`
- RustFS access key: `mercel-local`
- RustFS secret key: `mercel-local-secret`

These credentials are for local development only. Override `RUSTFS_ACCESS_KEY`
and `RUSTFS_SECRET_KEY` in `.env` if needed. Ports bind only to localhost.
Create buckets through the RustFS console; use path-style addressing in S3 clients.

```sh
docker compose down
```

Stopping services preserves Redis and object data in named Docker volumes.
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
bun run start       # Run without watching
bun run typecheck   # Check TypeScript without emitting files
bun run test        # Run Vitest once; requires Docker
bun run test:watch  # Rerun Vitest on changes
bun run check       # Check lint and formatting
bun run fix         # Fix lint and formatting
PORT=4000 bun run dev
```

Bun runs TypeScript directly. No build step required. Use explicit `.ts`
extensions in local imports. Vitest runs `src/**/*.test.ts`, excluding cloned
repositories in `output/`. Use `bun run test`, not `bun test`, which invokes
Bun's own test runner. Tool scripts use `--bun` to run under Bun rather than Node.js.

The deploy integration test starts an isolated `redis:8-alpine` Docker container
on a random localhost port and removes it afterward. It uses a local HTTP S3
stub and never connects to the Redis or S3 services in `.env`.

For CI, make Docker available, install with `bun install --frozen-lockfile`, then
run `bun run typecheck` and `bun run test`.
