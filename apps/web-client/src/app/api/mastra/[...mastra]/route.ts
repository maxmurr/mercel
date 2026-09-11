import { createNextRouteHandler } from "@mastra/next";
import { mastra } from "@/mastra";

export const runtime = "nodejs";

/** Mounts Mastra's native API under the Next.js catch-all route. */
export const { GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD } =
  createNextRouteHandler({
    mastra,
    prefix: "/api/mastra",
  });
