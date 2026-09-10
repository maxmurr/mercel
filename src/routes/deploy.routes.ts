import { Elysia, t } from "elysia";
import { evlog } from "evlog/elysia";
import type { IUploadService } from "../services/upload.service.interface.ts";
import { generateId } from "../utils/id.ts";

/** Assigns one upload ID and returns it only after clone, upload, and enqueue succeed. */
export const createDeployRoutes = (uploadService: IUploadService) =>
  new Elysia().use(evlog()).post(
    "/deploy",
    async ({ body, log, status }) => {
      const id = generateId();
      log.set({ action: "deploy", id });
      try {
        await uploadService.uploadRepository({
          id,
          onProgress: (progress) => log.set({ ...progress }),
          repoUrl: body.repoUrl,
        });
      } catch (error) {
        log.error(error instanceof Error ? error : new Error(String(error)));
        return status(500, { id });
      }
      return { id };
    },
    {
      body: t.Object({
        repoUrl: t.String({
          examples: ["https://github.com/example/repo.git"],
          minLength: 1,
        }),
      }),
      response: {
        200: t.Object({ id: t.String() }),
        500: t.Object({ id: t.String() }),
      },
    }
  );
