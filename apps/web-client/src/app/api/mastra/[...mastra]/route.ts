import { MessageList } from "@mastra/core/agent";
import { createNextRouteHandler } from "@mastra/next";
import { safeValidateUIMessages, type UIMessage } from "ai";
import { z } from "zod";
import {
  parseQuestionnaireAnswers,
  questionnaireInputSchema,
} from "@/features/chat/chat-questionnaire";
import { threadAccess } from "@/features/chat/chat-thread-access";
import { mastra } from "@/mastra";

const handlers = createNextRouteHandler({ mastra, prefix: "/api/mastra" });

const chatRoutes = new Set([
  "/api/mastra/agents/agent/stream",
  "/api/mastra/agents/agent/resume-stream",
  "/api/mastra/agents/agent/approve-tool-call",
  "/api/mastra/agents/agent/decline-tool-call",
]);

const chatRequestSchema = z.object({
  memory: z.object({ thread: z.uuid() }),
});
const streamRequestSchema = chatRequestSchema.extend({
  messages: z.array(z.unknown()).min(1),
});

/**
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
}): Promise<Response | undefined> {
  const memory = await mastra.getAgentById("agent").getMemory();
  if (!memory) {
    return;
  }
  // Message IDs are global upsert keys, so a valid thread alone does not authorize overwriting them.
  const storage = await mastra.getStorage()?.getStore("memory");
  const existing = await storage?.listMessagesById({
    messageIds: messages.map((message) => message.id),
  });
  if (
    existing?.messages.some(
      (message) =>
        message.threadId !== threadId || message.resourceId !== resourceId
    )
  ) {
    return Response.json(
      { error: "Message belongs to another conversation" },
      { status: 403 }
    );
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

const continuationRequestSchema = chatRequestSchema.extend({
  reason: z.string().optional(),
  resumeData: z.unknown().optional(),
  runId: z.string().min(1),
  toolCallId: z.string().min(1),
});

async function authorizeContinuation(
  body: unknown,
  userId: string,
  pathname: string
) {
  const parsed = continuationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid chat continuation request" },
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
  const isResume = pathname.endsWith("/resume-stream");
  // Approval-gated calls continue through approve/decline, the rest through resume-stream.
  const isWrongContinuationRoute = tool?.requiresApproval === isResume;
  if (!tool || isWrongContinuationRoute) {
    return Response.json(
      { error: "Suspended tool call not found" },
      { status: 409 }
    );
  }
  if (!isResume) {
    return {
      reason: pathname.endsWith("/decline-tool-call") ? data.reason : undefined,
      runId: data.runId,
      toolCallId: data.toolCallId,
    };
  }
  if (data.resumeData === undefined) {
    return Response.json({ error: "Missing resume data" }, { status: 400 });
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
    resumeData: data.resumeData,
    runId: data.runId,
    toolCallId: data.toolCallId,
  };
}

async function parseStreamInput(body: unknown) {
  const stream = streamRequestSchema.safeParse(body);
  const messages = await safeValidateUIMessages({
    messages: stream.success ? stream.data.messages : undefined,
  });
  if (!messages.success) {
    return Response.json({ error: "Invalid chat messages" }, { status: 400 });
  }
  return { messages: messages.data };
}

async function parseChatRequest(request: Request, url: URL) {
  if (request.method !== "POST" || !chatRoutes.has(url.pathname)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    return Response.json({ error: "JSON request required" }, { status: 415 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON request" }, { status: 400 });
  }
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid chat thread" }, { status: 400 });
  }
  return { body, threadId: parsed.data.memory.thread };
}

async function authorize(request: Request): Promise<Request | Response> {
  const visitor = await threadAccess(request);
  if (visitor instanceof Response) {
    return visitor;
  }
  const url = new URL(request.url);
  const chat = await parseChatRequest(request, url);
  if (chat instanceof Response) {
    return chat;
  }
  const { body, threadId } = chat;
  const access = await threadAccess(request, threadId);
  if (access instanceof Response) {
    return access;
  }

  const input = url.pathname.endsWith("/stream")
    ? await parseStreamInput(body)
    : await authorizeContinuation(body, access.userId, url.pathname);
  if (input instanceof Response) {
    return input;
  }
  if ("messages" in input) {
    const saved = await saveTurnInput({
      messages: input.messages,
      resourceId: access.userId,
      threadExists: Boolean(access.thread),
      threadId,
    });
    if (saved instanceof Response) {
      return saved;
    }
  }

  url.search = "";
  const headers = new Headers(request.headers);
  // The rewritten body is a different length, and the original stream is spent.
  headers.delete("content-length");
  return new Request(url, {
    body: JSON.stringify({
      ...input,
      memory: { resource: access.userId, thread: threadId },
      requestContext: { opencodeSessionId: threadId, threadId },
    }),
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

export const GET = guard(handlers.GET);
export const POST = guard(handlers.POST);
export const PUT = guard(handlers.PUT);
export const DELETE = guard(handlers.DELETE);
export const PATCH = guard(handlers.PATCH);
export const OPTIONS = guard(handlers.OPTIONS);
export const HEAD = guard(handlers.HEAD);
