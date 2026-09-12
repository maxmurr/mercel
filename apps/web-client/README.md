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
`opencode-go/glm-5.3-flash`, through Mastra's model router, with no
conversation memory.

OpenCode Go requires `x-opencode-session` and a client-specific `User-Agent`.
The agent sends both. It stores a generated session UUID in request context;
reuse that context across turns, or provide the same `opencodeSessionId` UUID
in Studio's request context for each turn. Independent calls get separate IDs.
For HTTP calls, pass the UUID as `requestContext.opencodeSessionId` in the JSON
body to reuse a routing session across turns. This does not enable memory.

Add your OpenCode Go key to `apps/web-client/.env.local`. The agent always
loads Exa web search and fetch tools from Exa's hosted MCP server, which works
without a key on a rate-limited free plan; set `EXA_API_KEY` to lift the limit.

```dotenv
OPENCODE_API_KEY=your-opencode-api-key
EXA_API_KEY=your-exa-api-key
```

Keep the key server-only, never in a `NEXT_PUBLIC_*` variable. Import Mastra from
Next.js server code, not client components. Mastra's default in-memory storage
loses data on restart; configure persistent storage before production use.

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
`POST /api/mastra/agents/agent/stream`. The `/chat` page uses this existing
endpoint through `@ai-sdk-tools/store`'s `useChat` and
`src/lib/mastra-chat-transport.ts`. There is no separate `/api/chat` route.
`@ai-sdk/react` remains installed as the store's peer dependency.

The transport converts native Mastra SSE text deltas into AI SDK UI messages.
It sends the full conversation and a stable `requestContext.opencodeSessionId`
UUID on each turn. New chat starts a new session. Stop, reset, and navigation
abort the current request; failed replies can be retried without duplicating
the user message. The connection throttles token updates to 50 ms before the
store batches them. `src/components/chat/chat-session.tsx` owns a store per
conversation and isolates the full `useChat` subscription. The message list
subscribes to IDs, each row to its message, and the composer to actions and busy
state. Draft edits stay in the composer; streamed deltas do not re-render the
page layout, preview, or completed messages. New chat remounts only the session,
clearing its store and draft without reloading the preview.

## Sandbox build loop

The agent works in a Mastra workspace rooted at `apps/web-client/.sandbox`
(`LocalFilesystem` plus `LocalSandbox` with macOS seatbelt or Linux bwrap
isolation, network allowed, `~/.npm` writable). It writes files with the
built-in `mastra_workspace_*` tools, runs `npm install`, starts `npm run dev`
with `background: true`, then calls `open_preview` (`src/mastra/tools/preview.ts`)
with the PID. That tool waits for the `http://localhost:PORT` line in the
process output and emits a `data-preview` chunk.

`src/lib/mastra-chat-transport.ts` forwards Mastra `data-*` chunks as transient
AI SDK data parts. `useChat` `onData` routes them into
`src/lib/sandbox-store.ts`: `data-preview` sets the iframe URL on the Preview
tab, and `data-sandbox-stdout/stderr/exit` from foreground commands feed the
Console drawer. Background processes only report to the server, so
`src/lib/process-log.ts` keeps their last 1000 lines and serves them at
`GET /api/sandbox/logs?after=<seq>` (`src/app/api/sandbox/logs/route.ts`); `SandboxConsole` polls it every two
seconds while the console is open or a preview exists. The Code tab refetches
folders and the open file every two seconds while visible.

The sandbox is shared by every chat and survives New chat; dev servers keep
running after the request that started them. The agent can stop them with
`kill_process` while the server process that spawned them is alive; after a
Next.js restart or HMR reload of the agent module they are orphaned, so kill
stray `vite` processes yourself. `open_preview` reads the URL from the process
it is given, so a new server on another port still previews correctly. Persistent history, approvals UI, and
Publish are not connected.

The adapter handles routing, validation, errors, and request cancellation. Its
default body limit is 4.5 MB. Configure it with `server.bodySizeLimit` on the
Mastra instance. See the [Next.js adapter reference](https://mastra.ai/reference/server/next-adapter).

This exposes Mastra's full API, with no authentication or rate limiting configured.
Keep it local until those controls are added; anyone with access can run agents
and spend your model quota.

## Deploy and preview

Deploy submits the fixed `maxmurr/vite-react-app` repository to the upload API.
The button shows a spinner and `Deploying...` while the server clones and uploads
source, then while the browser polls `/status?id=...` every two seconds. Only
`completed` shows congratulations and a live preview. Click anywhere on the
preview card to open the site in a new tab. The preview requests dark mode for
sites that support `prefers-color-scheme`.

Follow the root [README](../../README.md#run) to configure PostgreSQL, Redis,
S3, the bucket, and migrations. Run `bun run dev` from the repository root to
start the frontend and all three backend services. The worker also needs Git's
cloned project to build with Node.js and npm compatible with its Vite version.
Build settings remain fixed: repository root, `npm ci --include=dev`,
`npm run build`, and `dist/` output.

Local endpoints work without extra web configuration. To override them:

```sh
cp apps/web-client/.env.example apps/web-client/.env.local
```

| Public variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_UPLOAD_SERVER_URL` | `http://localhost:3000` | Upload and status API origin |
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

Failed deployments allow an explicit new Deploy. Temporary status failures retry
twice, then pause with `Check status`, which checks the same deployment without
starting another job. POST requests never auto-retry. If a POST response is lost,
the outcome is unknown and a new Deploy may create another job.

Leaving or refreshing the page stops frontend observation, not the backend job.
No deployment history or refresh recovery is stored. A stopped worker leaves the
job queued until it starts. Backend crashes or failed database writes can leave
a stale status; the UI does not invent a timeout or completion state.

Only deploy trusted repositories. Install/build scripts execute on the worker
host without a sandbox; this frontend does not make the backend safe for public,
untrusted use.

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
