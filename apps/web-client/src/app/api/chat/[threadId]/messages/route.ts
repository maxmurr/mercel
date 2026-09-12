import { getChatThread } from "@/features/chat/chat-queries";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/chat/[threadId]/messages">
) {
  const { threadId } = await params;
  const thread = await getChatThread(threadId, request.headers);
  return thread instanceof Response ? thread : Response.json(thread);
}
