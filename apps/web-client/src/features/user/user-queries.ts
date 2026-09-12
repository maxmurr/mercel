import "server-only";

import { cache } from "react";
import { auth } from "@/features/user/user-auth";

export const getUserSession = cache((requestHeaders: Headers) =>
  auth.api.getSession({ headers: requestHeaders })
);
