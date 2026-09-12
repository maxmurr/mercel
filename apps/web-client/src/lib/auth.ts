import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { account, session, user, verification } from "@repo/db/auth-schema";
import { betterAuth } from "better-auth";
import { postgresDb } from "@/lib/database";

const githubClientId = process.env.GITHUB_CLIENT_ID;
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;

if (!(githubClientId && githubClientSecret)) {
  throw new Error(
    "GitHub OAuth configuration missing: set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET."
  );
}

/** Server-side auth instance; the secret and base URL come from BETTER_AUTH_* env vars. */
export const auth = betterAuth({
  account: { encryptOAuthTokens: true },
  database: drizzleAdapter(postgresDb, {
    provider: "pg",
    schema: { account, session, user, verification },
  }),
  socialProviders: {
    github: { clientId: githubClientId, clientSecret: githubClientSecret },
  },
});
