import { and, eq, inArray } from "drizzle-orm";
import { log as logger } from "evlog";
import { postgresDb } from "./database.ts";
import { type deploymentStatus, deployments } from "./schema.ts";

/**
 * Records `failed` for a deployment still in one of the `from` statuses, so a
 * late failure cannot overwrite a newer attempt. Logs instead of throwing so
 * the original error stays the one reported.
 */
export const markDeploymentFailed = async ({
  id,
  from,
}: {
  id: string;
  from: (typeof deploymentStatus.enumValues)[number][];
}): Promise<void> => {
  try {
    await postgresDb
      .update(deployments)
      .set({ status: "failed" })
      .where(and(eq(deployments.id, id), inArray(deployments.status, from)));
  } catch (error) {
    logger.error({
      action: "deployment_status_failed",
      error: error instanceof Error ? error.message : String(error),
      id,
    });
  }
};
