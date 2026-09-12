import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/features/user/user-auth";

export const { GET, POST } = toNextJsHandler(auth);
