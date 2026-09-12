import { type ParseResult, parseJsonEventStream } from "@ai-sdk/provider-utils";
import {
  HttpChatTransport,
  isToolUIPart,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { z } from "zod";
import {
  isQuestionnairePart,
  parseQuestionnaireAnswers,
  questionnaireInputSchema,
} from "@/features/chat/chat-questionnaire";

const mastraChunkSchema = z.object({
  data: z.unknown().optional(),
  payload: z.unknown().optional(),
  runId: z.string().optional(),
  type: z.string(),
});
type MastraChunk = z.infer<typeof mastraChunkSchema>;

const partPayloadSchema = z.object({
  id: z.string().default("part"),
  text: z.string().default(""),
});

const toolPayloadSchema = z.object({
  args: z.unknown().optional(),
  argsTextDelta: z.string().default(""),
  error: z.unknown().optional(),
  isError: z.boolean().default(false),
  result: z.unknown().optional(),
  suspendPayload: z.unknown().optional(),
  toolCallId: z.string(),
  toolName: z.string().default(""),
});

type PartKind = "text" | "reasoning";

// Mastra's own convention: pack the run into the approval id so the answer can find the suspended run.
const approvalIdSeparator = "::";

/** Builds the approve or decline request for the tool call the user just answered, if there is one. */
export function toolApprovalRequest(messages: UIMessage[]) {
  const lastMessage = messages.at(-1);
  if (lastMessage?.role !== "assistant") {
    return;
  }
  for (const part of lastMessage.parts) {
    if (!isToolUIPart(part) || part.state !== "approval-responded") {
      continue;
    }
    const separatorIndex = part.approval.id.indexOf(approvalIdSeparator);
    if (separatorIndex === -1) {
      continue;
    }
    if (isQuestionnairePart(part) && part.approval.approved) {
      return {
        body: {
          resumeData: parseQuestionnaireAnswers(
            questionnaireInputSchema.parse(part.input),
            JSON.parse(part.approval.reason ?? "null")
          ),
          runId: part.approval.id.slice(0, separatorIndex),
          toolCallId: part.toolCallId,
        },
        route: "resume-stream",
      };
    }
    return {
      body: {
        reason: part.approval.reason,
        runId: part.approval.id.slice(0, separatorIndex),
        toolCallId: part.toolCallId,
      },
      route: part.approval.approved ? "approve-tool-call" : "decline-tool-call",
    };
  }
}

const partChunkKinds: Record<string, PartKind | undefined> = {
  "reasoning-delta": "reasoning",
  "reasoning-end": "reasoning",
  "reasoning-start": "reasoning",
  "text-delta": "text",
  "text-end": "text",
  "text-start": "text",
};

/** Drops Mastra's internal metadata so the UI shows only the arguments the model wrote. */
function toolInput(args: unknown) {
  if (typeof args !== "object" || args === null) {
    return args;
  }
  const { __mastraMetadata: _metadata, ...input } = args as Record<
    string,
    unknown
  >;
  return input;
}

function errorText(error: unknown) {
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return JSON.stringify(error) ?? "Tool failed";
}

/** Maps one native Mastra tool chunk onto the AI SDK tool chunks the chat store understands. */
function toolChunks(
  type: string,
  payload: unknown,
  runId: string | undefined
): UIMessageChunk[] {
  const parsed = toolPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return [];
  }
  const tool = parsed.data;
  const { toolCallId, toolName } = tool;
  switch (type) {
    case "tool-call-input-streaming-start":
      return [{ toolCallId, toolName, type: "tool-input-start" }];
    case "tool-call-delta":
      return [
        {
          inputTextDelta: tool.argsTextDelta,
          toolCallId,
          type: "tool-input-delta",
        },
      ];
    case "tool-call":
      return [
        {
          input: toolInput(tool.args),
          toolCallId,
          toolName,
          type: "tool-input-available",
        },
      ];
    case "tool-call-suspended":
      if (toolName !== "ask_user" || !runId) {
        return [];
      }
      // AI SDK has no suspended tool state; its approval slot carries the run identity until answers resume it.
      return [
        {
          input: toolInput(tool.suspendPayload ?? tool.args),
          toolCallId,
          toolName,
          type: "tool-input-available",
        },
        {
          approvalId: `${runId}${approvalIdSeparator}${toolCallId}`,
          toolCallId,
          type: "tool-approval-request",
        },
      ];
    case "tool-call-approval":
      // Mastra may not emit tool-call first, so make sure the part exists before flagging it.
      return [
        {
          input: toolInput(tool.args),
          toolCallId,
          toolName,
          type: "tool-input-available",
        },
        {
          approvalId: runId
            ? `${runId}${approvalIdSeparator}${toolCallId}`
            : toolCallId,
          toolCallId,
          type: "tool-approval-request",
        },
      ];
    case "tool-result":
      return tool.isError
        ? [
            {
              errorText: errorText(tool.result),
              toolCallId,
              type: "tool-output-error",
            },
          ]
        : [{ output: tool.result, toolCallId, type: "tool-output-available" }];
    case "tool-error":
      return [
        {
          errorText: errorText(tool.error),
          toolCallId,
          type: "tool-output-error",
        },
      ];
    case "tool-output-denied":
      return [{ toolCallId, type: "tool-output-denied" }];
    default:
      return [];
  }
}

/** Converts native Mastra SSE into AI SDK text, reasoning, and tool parts without a second API route. */
export class MastraChatTransport extends HttpChatTransport<UIMessage> {
  protected override processResponseStream(stream: ReadableStream<Uint8Array>) {
    // The AI SDK rejects deltas without a start chunk, so open parts are tracked
    // to synthesize missing starts and close whatever is still open at the end.
    const openParts = new Map<string, { id: string; kind: PartKind }>();

    return parseJsonEventStream({
      schema: mastraChunkSchema,
      stream,
    }).pipeThrough(
      new TransformStream<ParseResult<MastraChunk>, UIMessageChunk>({
        flush(controller) {
          for (const { id, kind } of openParts.values()) {
            controller.enqueue({ id, type: `${kind}-end` });
          }
          controller.enqueue({ type: "finish-step" });
          controller.enqueue({ type: "finish" });
        },
        start(controller) {
          controller.enqueue({ type: "start" });
          controller.enqueue({ type: "start-step" });
        },
        transform(chunk, controller) {
          if (!chunk.success) {
            throw new Error("Invalid Mastra chat stream", {
              cause: chunk.error,
            });
          }
          const { type, payload, runId } = chunk.value;
          if (type === "error") {
            throw new Error("Mastra chat stream failed");
          }
          if (type.startsWith("data-")) {
            // Sandbox output and preview URLs feed UI state only; keep them out of message history.
            controller.enqueue({
              data: chunk.value.data,
              transient: true,
              type: type as `data-${string}`,
            });
            return;
          }
          if (type.startsWith("tool-")) {
            for (const toolChunk of toolChunks(type, payload, runId)) {
              controller.enqueue(toolChunk);
            }
            return;
          }
          const kind = partChunkKinds[type];
          if (!kind) {
            return;
          }
          const { id, text } = partPayloadSchema.parse(payload);
          const key = `${kind}:${id}`;
          if (type.endsWith("-end")) {
            openParts.delete(key);
            controller.enqueue({ id, type: `${kind}-end` });
            return;
          }
          if (!openParts.has(key)) {
            openParts.set(key, { id, kind });
            controller.enqueue({ id, type: `${kind}-start` });
          }
          if (type.endsWith("-delta")) {
            controller.enqueue({ delta: text, id, type: `${kind}-delta` });
          }
        },
      })
    );
  }
}

const agentApi = "/api/mastra/agents/agent";

/**
 * Builds the chat transport for one thread's owner.
 *
 * Mastra reloads the thread from storage on every turn, so only the newest
 * message travels with the request; sending the whole history would duplicate
 * it and fight the stored timestamps.
 */
export function createChatTransport(resourceId: string) {
  return new MastraChatTransport({
    api: `${agentApi}/stream`,
    // Mastra's own stream route starts a turn; this one re-attaches to the
    // turn a reload left running, replayed from its first chunk.
    prepareReconnectToStreamRequest: ({ id }) => ({
      api: `/api/chat/${encodeURIComponent(id)}/stream`,
    }),
    prepareSendMessagesRequest: ({ id, messages }) => {
      // threadId picks the thread's own sandbox; without it the agent has nowhere to build.
      const requestContext = { opencodeSessionId: id, threadId: id };
      // An answered approval resumes the suspended run instead of starting a new turn.
      const approval = toolApprovalRequest(messages);
      if (approval) {
        return {
          api: `${agentApi}/${approval.route}`,
          body: {
            ...approval.body,
            ...(approval.route === "resume-stream"
              ? { memory: { resource: resourceId, thread: id } }
              : {}),
            requestContext,
          },
        };
      }
      return {
        body: {
          memory: { resource: resourceId, thread: id },
          messages: messages.slice(-1),
          requestContext,
        },
      };
    },
  });
}
