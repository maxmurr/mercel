# Web client

Next.js App Router with TypeScript and Tailwind CSS. Uses the workspace's Bun,
Turborepo, and Ultracite setup. Requires Node.js 22.13 or later for Mastra.

From the repository root:

```sh
bun install
bun run dev:web
```

Open http://localhost:3002. Ports 3000 and 3001 belong to the backend services.
Override with `PORT=4000 bun run dev:web`.

Edit `apps/web-client/src/app/page.tsx` to change the home page. The `@/*` import alias
points to `apps/web-client/src/*`.

## Mastra

`src/mastra/index.ts` registers `agent`, a coding agent defined in
`src/mastra/agents/agent.ts` with its system prompt in
`src/mastra/agents/instructions.md`. It uses GLM 5.3 Flash, model ID
`opencode-go/glm-5.3-flash`, through Mastra's model router.

OpenCode Go requires `x-opencode-session` and a client-specific `User-Agent`.
The agent sends both. It stores a generated session UUID in request context;
reuse that context across turns, or provide the same `opencodeSessionId` UUID
in Studio's request context for each turn. Independent calls get separate IDs.
For HTTP calls, pass the UUID as `requestContext.opencodeSessionId` in the JSON
body to reuse a routing session across turns. This is routing only; conversation
history comes from memory.

### Memory

Threads and messages persist in the app's Postgres through `PostgresStore`,
configured on the Mastra instance in `src/mastra/index.ts`; the agent's `Memory`
inherits it and replays the last 20 turns into the model's context. Mastra
creates and migrates its own tables on first use, so they are not part of the
Drizzle schema.

Callers send only the newest message plus `memory: { thread, resource }`;
Mastra loads the rest from storage. `thread` is the thread ID in the chat URL.
`resource` is the owning account, or the thread ID itself for a thread opened
while signed out. The web client reads a thread back through
`GET /api/chat/[threadId]/messages`, which resolves the resource from the
session rather than trusting the caller.

Add your OpenCode Go key to `apps/web-client/.env.local`. The agent always
loads Exa web search and fetch tools from Exa's hosted MCP server, which works
without a key on a rate-limited free plan; set `EXA_API_KEY` to lift the limit.

```dotenv
OPENCODE_API_KEY=your-opencode-api-key
EXA_API_KEY=your-exa-api-key
```

Keep the key server-only, never in a `NEXT_PUBLIC_*` variable. Import Mastra from
Next.js server code, not client components.

This app uses TypeScript 6 because the Mastra CLI's `typescript-paths` dependency
requires compiler APIs removed in TypeScript 7. Other workspaces keep the catalog
version.

Run Studio in a separate terminal from the repository root:

```sh
bun run --cwd apps/web-client dev:mastra
```

Open http://localhost:4111 and select **Agent** to chat. In server code,
call `await mastra.getAgentById("agent").generate("Hello!")` and read
`result.text` from the returned result.

Generated Studio files stay in the ignored `.mastra/` directory.

### Native Mastra API in Next.js

`src/app/api/mastra/[...mastra]/route.ts` mounts `createNextRouteHandler` from
`@mastra/next` at `/api/mastra`. Start Next.js with `bun run dev:web`; the separate
Mastra server is not required.

List agents without calling a model:

```sh
curl http://localhost:3002/api/mastra/agents
```

Generate a reply:

```sh
curl http://localhost:3002/api/mastra/agents/agent/generate \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Write a JavaScript function that adds two numbers."}]}'
```

The response uses Mastra's native format, including `text`, usage, and execution
metadata. Native streaming is available at
`POST /api/mastra/agents/agent/stream`. The `/chat/[threadId]` page uses this
existing endpoint through `@ai-sdk-tools/store`'s `useChat` and
`src/lib/mastra-chat-transport.ts`. There is no separate `/api/chat` route.
`@ai-sdk/react` remains installed as the store's peer dependency.

The transport converts native Mastra SSE text deltas into AI SDK UI messages.
It sends only the newest message, because Mastra reloads the rest from memory,
plus a `requestContext` carrying the thread ID as both `opencodeSessionId` and
`threadId`, so each thread keeps its own routing session and its own sandbox.
Stop, reset, and navigation abort the current request; failed replies can be
retried without duplicating the user message. The connection throttles token
updates to 50 ms before the store batches them.
`src/components/chat/chat-session.tsx` owns a store per conversation and isolates
the full `useChat` subscription. The message list
subscribes to IDs, each row to its message, and the composer to actions and busy
state. Draft edits stay in the composer; streamed deltas do not re-render the
page layout, preview, or completed messages. New chat remounts only the session,
clearing its store and draft without reloading the preview.

`src/components/ai-elements/tool.tsx` renders each tool call as one row. Writes,
edits, commands, and `open_preview` say what they did — the path, the command,
the preview URL — and expand to the file content, a diff, or the command output;
everything else falls back to the tool name and its raw input or result. The
read-only workspace calls (`read_file`, `list_files`, `file_stat`, `grep`,
`search`, `index`, `lsp_inspect`, `get_process_output`) render nothing, so a turn
spent reading shows the thinking indicator rather than a wall of rows.

## Sandbox build loop

The agent works in a Mastra workspace rooted at `apps/web-client/.sandbox`
(`LocalFilesystem` plus `LocalSandbox` with macOS seatbelt or Linux bwrap
isolation, network allowed, `~/.npm` writable). It writes files with the
built-in `mastra_workspace_*` tools, runs `npm install`, starts `npm run dev`
with `background: true`, then calls `open_preview` (`src/mastra/tools/preview.ts`)
with the PID. That tool waits for the `http://localhost:PORT` line in the
process output and emits a `data-preview` chunk.

New threads are seeded from `templates/vite-react`: Vite + React + TypeScript +
Tailwind CSS v4 with every shadcn/ui component (Radix base) already added.
`src/mastra/thread-workspace.ts` copies it into `.sandbox/<threadId>` the first
time a thread runs, without `node_modules`, so the agent still runs `npm install`.
To refresh the starter, run `npx shadcn@latest add --all --overwrite -y` inside
the template directory and commit the result.

`src/lib/mastra-chat-transport.ts` forwards Mastra `data-*` chunks as transient
AI SDK data parts. `useChat` `onData` routes them into
`src/lib/sandbox-store.ts`: `data-preview` sets the iframe URL on the Preview
tab, and `data-sandbox-stdout/stderr/exit` from foreground commands feed the
Console drawer. Background processes only report to the server, so
`src/lib/process-log.ts` keeps their last 1000 lines and serves them at
`GET /api/sandbox/logs/<threadId>?after=<seq>`
(`src/app/api/sandbox/logs/[threadId]/route.ts`), filtered to the processes that
thread's sandbox owns; `SandboxConsole` polls it every two seconds while the
console is open or a preview exists. The Code tab refetches folders and the open
file every two seconds while visible.

Each thread keeps its own sandbox, created on first use and reused across turns
(`src/mastra/thread-workspace.ts`); dev servers keep running after the request
that started them. A sandbox that no turn has used for 30 minutes is stopped:
its dev servers are killed, its files stay in `.sandbox/<threadId>`, and the
next turn starts a fresh sandbox there. Before that, the agent can stop them with `kill_process` while the server
process that spawned them is alive; after a Next.js restart or HMR reload of the
agent module they are orphaned, so kill
stray `vite` processes yourself. `open_preview` reads the URL from the process
it is given, so a new server on another port still previews correctly. Persistent history and approvals UI are
not connected.

The adapter handles routing, validation, errors, and request cancellation. Its
default body limit is 4.5 MB. Configure it with `server.bodySizeLimit` on the
Mastra instance. See the [Next.js adapter reference](https://mastra.ai/reference/server/next-adapter).

This exposes Mastra's full API to any signed-in account, with no rate limiting
configured. Keep it local until that control is added; anyone who can sign in
can run agents and spend your model quota.

## Authentication

Better Auth handles GitHub sign-in. `src/lib/auth.ts` builds the server instance
on the Drizzle adapter, `src/app/api/auth/[...all]/route.ts` mounts it at
`/api/auth`, and `src/lib/auth-client.ts` exposes the browser client. The
`/sign-in` page calls `authClient.signIn.social` with the `github` provider and
a `/chat` callback. Conversations live at `/chat/[threadId]`, keyed by the
thread ID in the URL.

The `user`, `session`, `account`, and `verification` tables live in
`packages/db/src/auth-schema.ts`, generated by `bunx auth generate` from this
app's config. Apply them with `bun run db:migrate` from the repository root.
Next.js renders on Node.js, so this app opens its own PostgreSQL pool in
`src/lib/database.ts` through `postgres`; `@repo/db/database` uses Bun's SQL
driver, which the Node.js runtime cannot load.

Register an OAuth app at https://github.com/settings/developers with the
callback URL `http://localhost:3002/api/auth/callback/github`, then add to
`apps/web-client/.env`:

```dotenv
DATABASE_URL=postgresql://mercel:mercel-local-secret@localhost:5432/mercel
BETTER_AUTH_SECRET=run-openssl-rand-base64-32
BETTER_AUTH_URL=http://localhost:3002
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
```

A GitHub App, as opposed to an OAuth app, also needs **Account permissions >
Email addresses** set to read-only, or sign-in fails with `email_not_found`.

`src/lib/auth.ts` throws on import while the GitHub variables are missing, so
`/api/auth/*` answers 500 until they are set. Confirm the wiring with
`curl http://localhost:3002/api/auth/ok`, which returns `{"ok":true}`.

Stored OAuth tokens are encrypted with the auth secret. Better Auth rate-limits
its endpoints in production and trusts only the `BETTER_AUTH_URL` origin; add
`trustedOrigins` when the app is served from another host. Every API route is
gated through `src/lib/thread-access.ts`: the Mastra API, the chat routes, the
workspace routes, and the sandbox logs all answer `401` without a session and
`403` for a thread owned by another account. The Mastra API also replaces the
`memory.resource` the browser sent with the signed-in account. Pages themselves
are not gated; a signed-out visitor can open them, and every request they make
is refused.

## Publish and preview

**Publish** in the chat header deploys the thread's sandbox. The browser calls
`POST /api/workspace/[threadId]/publish`
(`src/app/api/workspace/[threadId]/publish/route.ts`), gated like the other
thread routes. The route archives `.sandbox/<threadId>` with `tar`, leaving out
`node_modules` and `dist`, posts the gzipped tarball to the upload API's
`POST /deploy` as the multipart `archive` field, and returns the deployment ID.
The archive is held in memory and capped at 64 MiB compressed.
`src/lib/deployment.ts` owns that request, the ID validation, the preview URL,
and the status poller both sides share as `deploymentStatusOptions`.

The button shows a spinner and `Publishing…` while the archive uploads, then
while the browser polls `/status?id=...` every two seconds. Only `completed`
adds an **Open site** link to the deployment's URL, opened in a new tab. A
thread that has not run anything yet has no directory and answers `404`, shown
as a toast. Publishing again after edits starts a new deployment with a new ID;
the earlier one stays online.

Follow the root [README](../../README.md#run) to configure PostgreSQL, Redis,
S3, the bucket, and migrations. Run `bun run dev` from the repository root to
start the frontend and all three backend services. The worker builds the
archive in a throwaway Docker container with fixed settings: project root,
`npm ci --include=dev`, `npm run build`, and `dist/` output, so the sandbox
must keep its `package-lock.json`.

Local endpoints work without extra web configuration. To override them:

```sh
cp apps/web-client/.env.example apps/web-client/.env.local
```

| Public variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_UPLOAD_SERVER_URL` | `http://localhost:3000` | Upload API origin; the publish route posts to it from the server, the browser polls status from it |
| `NEXT_PUBLIC_PREVIEW_BASE_URL` | `http://localhost:3001` | Preview base origin, before the deployment subdomain |

Set HTTP(S) origins without credentials, paths, queries, or fragments. Preview
base must be a hostname that supports subdomains, not an IP address. Deployment
`abc12` opens `http://abc12.localhost:3001/` locally. If your browser does not
resolve `*.localhost`, configure a wildcard loopback hostname and set the preview
base to that hostname.

Production needs browser-reachable HTTPS API and preview origins. Route
`*.<preview-base-hostname>` to the request handler with wildcard DNS and TLS,
preserving the deployment hostname. Preview must use a different origin from
the dashboard. Frame policies must allow the dashboard to embed previews.
For example, `https://preview.example.com` produces
`https://abc12.preview.example.com/`. Upload API already supports credential-free
CORS. Never put secrets in `NEXT_PUBLIC_*` variables.

Next.js embeds public variables during `next build`; set them before building
and rebuild when they change. Turbo already infers `NEXT_PUBLIC_*` variables and
includes web `.env*` files in build inputs.

A failed build re-enables **Publish**. Temporary status failures retry twice,
then pause with `Check status`, which checks the same deployment without
starting another job. The publish request never auto-retries. If its response
is lost, the outcome is unknown and publishing again may create another job.

Leaving or refreshing the page stops frontend observation, not the backend job.
No deployment history or refresh recovery is stored. A stopped worker leaves the
job queued until it starts. Backend crashes or failed database writes can leave
a stale status; the UI does not invent a timeout or completion state.

The upload API accepts archives from anyone who can reach it; only this app's
route checks who owns the thread. Keep the upload server off the public internet
until it authenticates callers.

```sh
bun run check --filter=web-client
bun run typecheck --filter=web-client
bun run test --filter=web-client
bun run build --filter=web-client
bun run start:web
```

## Queries and forms

`src/components/query-provider.tsx` wraps the app with TanStack Query. It uses
`src/lib/query-client.ts` for isolated server caches and one browser cache that
survives Suspense retries. Queries stay fresh for 60 seconds by default.
Import `useQuery` and `useMutation` from `@tanstack/react-query` in client components.

TanStack Form needs no global provider. Import `useForm` from
`@tanstack/react-form` in a component marked `"use client"`. Use its `form.Field`
with existing `@/components/ui/field` and input components. Add shared form hooks
when forms need reusable field components.
