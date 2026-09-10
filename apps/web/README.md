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
bun run test --filter=@repo/web
bun run build --filter=@repo/web
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
