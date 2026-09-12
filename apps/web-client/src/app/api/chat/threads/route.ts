import { getChatThreads } from "@/features/chat/chat-queries";

export async function GET(request: Request) {
  const threads = await getChatThreads(request.headers);
  return threads instanceof Response ? threads : Response.json({ threads });
}
