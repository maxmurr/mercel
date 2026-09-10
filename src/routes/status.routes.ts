import type { Queue } from "bullmq";
import { Elysia, t } from "elysia";
import { evlog } from "evlog/elysia";

/** Reads upload status from the server-owned job queue without caching responses. */
export const createStatusRoutes = (
  jobQueue: Pick<Queue<{ uploadId: string }>, "getJob">
) =>
  new Elysia().use(evlog()).get(
    "/status",
    async ({ query, log, set, status }) => {
      set.headers["cache-control"] = "no-store";
      log.set({ action: "upload-status", id: query.id });
      try {
        const job = await jobQueue.getJob(query.id);
        const currentStatus = job ? await job.getState() : "unknown";
        if (currentStatus === "unknown") {
          return status(404, { message: "Upload not found" });
        }
        return { status: currentStatus };
      } catch (error) {
        log.error(error instanceof Error ? error : new Error(String(error)));
        return status(503, { message: "Upload status unavailable" });
      }
    },
    {
      query: t.Object({ id: t.String({ pattern: "^[0-9A-Za-z]{5}$" }) }),
      response: {
        200: t.Object({ status: t.String() }),
        404: t.Object({ message: t.String() }),
        503: t.Object({ message: t.String() }),
      },
    }
  );
