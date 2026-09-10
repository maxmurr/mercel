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

`src/mastra/index.ts` registers `agent`, a simple assistant defined in
`src/mastra/agents/agent.ts`. It uses DeepSeek V4.1 Flash, model ID
`opencode-go/deepseek-flash`, through Mastra's model router, with no tools or
conversation memory.

Add your OpenCode Go key to `apps/web-client/.env.local`:

```dotenv
OPENCODE_API_KEY=your-opencode-api-key
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

`bun run dev:web` still starts Next.js on port 3002. Generated Studio files stay
in the ignored `.mastra/` directory. This setup does not add a Next.js chat route.

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
