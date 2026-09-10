# Web

Next.js App Router with TypeScript and Tailwind CSS. Uses the workspace's Bun,
Turborepo, and Ultracite setup. Requires Node.js 20.9 or later.

From the repository root:

```sh
bun install
bun run dev:web
```

Open http://localhost:3002. Ports 3000 and 3001 belong to the backend services.
Override with `PORT=4000 bun run dev:web`.

Edit `apps/web/src/app/page.tsx` to change the home page. The `@/*` import alias
points to `apps/web/src/*`. No backend services are needed for this starter.

```sh
bun run check --filter=@repo/web
bun run typecheck --filter=@repo/web
bun run build --filter=@repo/web
bun run start:web
```
