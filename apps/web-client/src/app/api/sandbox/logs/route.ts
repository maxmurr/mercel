import { readProcessLogs } from "@/lib/process-log";

export const runtime = "nodejs";

/** Serves background process output recorded by the agent's sandbox; `after` is the last seen seq. */
export function GET(request: Request) {
  const after = Number(new URL(request.url).searchParams.get("after") ?? 0);
  return Response.json({ entries: readProcessLogs(after) });
}
