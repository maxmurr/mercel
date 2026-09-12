import { createAuthClient } from "better-auth/react";

/** Browser auth client; requests go to this app's own /api/auth routes. */
export const authClient = createAuthClient();
