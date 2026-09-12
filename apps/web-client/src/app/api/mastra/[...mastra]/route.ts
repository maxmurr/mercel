import { MessageList } from "@mastra/core/agent";
import { createNextRouteHandler } from "@mastra/next";
import type { UIMessage } from "ai";
import { z } from "zod";
import {
  parseQuestionnaireAnswers,
  questionnaireInputSchema,
} from "@/features/chat/chat-questionnaire";
import { threadAccess } from "@/features/chat/chat-thread-access";
import { mastra } from "@/mastra";

const handlers = createNextRouteHandler({ mastra, prefix: "/api/mastra" });

interface AgentRequestBody {
  memory?: { resource?: string; thread?: string };
  messages?: UIMessage[];
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
 * Stores the messages a turn opens with before its run starts.
 *
 * Mastra writes a turn's messages only once the reply lands, so a chat that
 * reloaded mid-reply would show an empty conversation while a reply to an
 * invisible prompt streamed into it. The run reuses these IDs, so its own save
 * overwrites these rows instead of adding a second copy.
 */
async function saveTurnInput({
  messages,
  resourceId,
  threadExists,
  threadId,
}: {
  messages: UIMessage[];
  resourceId: string;
  threadExists: boolean;
  threadId: string;
}) {
  const memory = await mastra.getAgentById("agent").getMemory();
  if (!memory) {
    return;
  }
  if (!threadExists) {
    await memory.createThread({ resourceId, threadId });
  }
  await memory.saveMessages({
    messages: new MessageList({ resourceId, threadId })
      .add(messages, "user")
      .get.input.db(),
  });
}

const resumeRequestSchema = z.object({
  memory: z.object({ thread: z.string().min(1) }),
  resumeData: z.unknown(),
  runId: z.string().min(1),
  toolCallId: z.string().min(1),
});

/** Binds resume data to a suspended call owned by the session before Mastra can execute it. */
async function authorizeResume(body: unknown, userId: string) {
  const parsed = resumeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid questionnaire resume request" },
      { status: 400 }
    );
  }
  const { data } = parsed;
  const { runs } = await mastra.getAgentById("agent").listSuspendedRuns({
    resourceId: userId,
    threadId: data.memory.thread,
  });
  const tool = runs
    .find((run) => run.runId === data.runId)
    ?.toolCalls.find((call) => call.toolCallId === data.toolCallId);
  if (!tool || tool.requiresApproval) {
    return Response.json(
      { error: "Suspended tool call not found" },
      { status: 409 }
    );
  }
  if (tool.toolName === "ask_user") {
    try {
      data.resumeData = parseQuestionnaireAnswers(
        questionnaireInputSchema.parse(tool.suspendPayload),
        data.resumeData
      );
    } catch {
      return Response.json(
        { error: "Invalid questionnaire answers" },
        { status: 400 }
      );
    }
  }
  return {
    ...data,
    requestContext: {
      opencodeSessionId: data.memory.thread,
      threadId: data.memory.thread,
    },
  };
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON request" }, { status: 400 });
  }
  const memory = memoryOf(body);
  const access = await threadAccess(request, memory?.thread);
  if (access instanceof Response) {
    return access;
  }

  if (new URL(request.url).pathname.endsWith("/resume-stream")) {
    body = await authorizeResume(body, access.userId);
    if (body instanceof Response) {
      return body;
    }
  }

  const { messages } = body as AgentRequestBody;
  if (memory?.thread && messages?.length) {
    await saveTurnInput({
      messages,
      resourceId: access.userId,
      threadExists: Boolean(access.thread),
      threadId: memory.thread,
    });
  }

  const headers = new Headers(request.headers);
  // The rewritten body is a different length, and the original stream is spent.
  headers.delete("content-length");
  // The forwarded request carries no abort signal: a run outlives the browser
  // that started it, so a reload resumes the reply at /api/chat/[threadId]/stream
  // instead of losing it. Stopping a reply goes to that route as well.
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
