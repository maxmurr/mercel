# Instant navigation tests: web-client

- BUILD: From `apps/web-client`, run `bun run build:e2e`. This runs `next build` into `.next-instant`, separate from normal production and development output.
- EXPOSE: `INSTANT_NAV_TEST=1` selects that output directory and enables `experimental.exposeTestingApiInProductionBuild`. Leave this variable unset in production. Never deploy `.next-instant`.
- START: `bun run start:e2e` serves the test build at `http://localhost:3012`. Playwright starts and stops this server for each run. `reuseExistingServer: false` rejects an occupied port rather than testing a stale process.
- RUN: `bun run test:e2e` runs Chromium at 1280×800 and 390×844, one worker, no retries. Install Chromium once with `bun x playwright install chromium`.
- TEST USER: An existing GitHub-authenticated local account, saved as Playwright storage state in `.auth/instant-nav.json`. The account needs at least one conversation. Tests select the first conversation returned by its authenticated `/api/chat/threads` response. No account IDs, thread IDs, or credentials are committed. Tests do not submit prompts, publish apps, or modify conversations.
- DRIFT: Login expiry, a missing conversation, unavailable Postgres, or a missing local preview server can differ between runs. The API preflight rejects expired login and empty conversation lists. No plan, role, locale, or feature-flag variants exist on these pages. Local runs use the signed-in developer account, not an assumed CI identity.
- CONTRACTS: `/chat` initial load and a real New Chat link from a conversation must show the heading, prompt, and sidebar toggle without account data. `/chat/[threadId]` initial load and its real sidebar link from `/chat` must show the sidebar toggle and conversation skeleton without the message composer or account data. Scope assertions to each destination's test ID so a preserved, hidden source page cannot satisfy them. Mobile runs open the sidebar to reach the real links.
- LOOP: Edit, `bun run build:e2e`, then `bun run test:e2e`. Each test starts with authenticated storage state without visiting the page. `instant()` holds dynamic content during assertions. Client navigations must resolve afterward; initial loads reload without the lock to verify the real UI. Screenshots of both states stay under ignored `test-results/`.
- LIVENESS: n/a; local build followed by a fresh Playwright-owned server. Rebuild after every app/config change. Neither `next dev` nor the server at port 3002 supplies test verdicts.
- WALLS: `.env` supplies the app's database and auth configuration. Reuse the existing database; do not seed or reset it. Authentication requires user-driven GitHub login when saved state expires. Two stream-pacing unit tests still time out independently of these browser checks. Typecheck passes.

## Save login state

With `bun run dev` running at port 3002, use a named browser session:

```sh
SESSION="$(agent-browser session id --scope worktree --prefix next-dev-loop)"
agent-browser --session "$SESSION" --restore --headed open http://localhost:3002/chat
# Sign in through GitHub in the browser if needed.
mkdir -p .auth
chmod 700 .auth
agent-browser --session "$SESSION" --restore state save .auth/instant-nav.json
chmod 600 .auth/instant-nav.json
agent-browser --session "$SESSION" --restore close
bun run build:e2e
bun run test:e2e
```

Run these commands from this directory. `.auth/` is ignored because storage state contains session credentials. Do not upload it or browser traces containing it. A CI job needs its own authenticated storage state and reachable test database; this local setup does not provision either.

## Verification results

Both routes already met these shell contracts after Cache Components adoption. No rendering refactor or cache expansion was needed. The only page changes are stable test IDs on the existing main elements.

- Unlocked baseline: all eight navigations reached their real UI on the test build. The temporary baseline spec was removed.
- Coarse-boundary negative control: temporarily wrapped each page's content in `Suspense fallback={null}` behind the existing `getChatThreads(await headers())` read. The unlocked baseline still passed eight tests; all eight `instant()` tests failed because the destination shell was absent. Both wrappers and their temporary helper were removed.
- Missing-API negative control: disabling the build's testing API caused seven of eight initial guards to fail. One raced against the arriving account data, so absence assertions alone were insufficient. The shipped preflight now checks the served build's `required-server-files.json`; it rejects that artifact before either viewport runs.
- Restored routes and testing API: `bun run test:e2e --repeat-each=3` passed 24 of 24 checks. The soft-navigation chat guard also confirms an unsent draft and focus survive account data arriving.
- Normal `bun run build` passes with the testing API disabled. Typecheck and changed-file lint pass. The unit suite has 212 passing tests and the same two stream-pacing timeouts.

Local run evidence: `/tmp/mercel-instant-blocked-baseline.log`, `/tmp/mercel-instant-blocked.log`, `/tmp/mercel-instant-negative-control.diff`, `/tmp/mercel-instant-no-api-guard.log`, and `/tmp/mercel-instant-final.log`. These are session artifacts, not committed fixtures. Rerun the commands above to obtain current results.

Screenshots under `test-results/` show shell and loaded states at both widths. The existing conversation header can clip actions at 390px; this test protects shell readiness, not a full responsive-layout audit. No page layout changed in this work.

Partial Prefetching is not enabled. Consider the `next-partial-prefetching-adoption` skill as a separate follow-up; these tests do not turn it on.
