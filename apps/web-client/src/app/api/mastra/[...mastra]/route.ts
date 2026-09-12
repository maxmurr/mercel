import { createNextRouteHandler } from "@mastra/next";
import { threadAccess } from "@/lib/thread-access";
import { mastra } from "@/mastra";

export const runtime = "nodejs";

const handlers = createNextRouteHandler({ mastra, prefix: "/api/mastra" });

interface AgentRequestBody {
  memory?: { resource?: string; thread?: string };
}

/** The memory options the browser sent, when it sent any. */
function memoryOf(body: unknown): AgentRequestBody["memory"] {
  if (typeof body !== "object" || body === null) {
    return;
  }
  const { memory } = body as AgentRequestBody;
  return typeof memory === "object" && memory !== null ? memory : undefined;
}

/**
 * Answers for the signed-in account rather than for whoever the request names.
 *
 * Mastra's native API reads the owner out of the request body, so a chat
 * request could otherwise append to, and replay, another account's
 * conversation. The session decides the owner here: it replaces the resource
 * the browser sent, and a thread stored under another account is refused.
 *
 * Returns the request to forward, or the response to send instead of forwarding
 * it.
 */
async function authorize(request: Request): Promise<Request | Response> {
  const isJsonPost =
    request.method === "POST" &&
    (request.headers.get("content-type") ?? "").includes("application/json");
  if (!isJsonPost) {
    const visitor = await threadAccess(request);
    return visitor instanceof Response ? visitor : request;
  }

  const body: unknown = await request.json();
  const memory = memoryOf(body);
  const access = await threadAccess(request, memory?.thread);
  if (access instanceof Response) {
    return access;
  }

  const headers = new Headers(request.headers);
  // The rewritten body is a different length, and the original stream is spent.
  headers.delete("content-length");
  return new Request(request.url, {
    body: JSON.stringify(
      memory
        ? {
            ...(body as AgentRequestBody),
            memory: { ...memory, resource: access.userId },
          }
        : body
    ),
    headers,
    method: "POST",
    signal: request.signal,
  });
}

function guard(handler: (request: Request) => Response | Promise<Response>) {
  return async (request: Request) => {
    const authorized = await authorize(request);
    return authorized instanceof Response
      ? authorized
      : await handler(authorized);
  };
}

/** Mounts Mastra's native API under the Next.js catch-all route, signed in only. */
export const GET = guard(handlers.GET);
export const POST = guard(handlers.POST);
export const PUT = guard(handlers.PUT);
export const DELETE = guard(handlers.DELETE);
export const PATCH = guard(handlers.PATCH);
export const OPTIONS = guard(handlers.OPTIONS);
export const HEAD = guard(handlers.HEAD);
