import { pgEnum, pgTable, varchar } from "drizzle-orm/pg-core";

/** Deployment status includes upload stages before a BullMQ job exists. */
export const deploymentStatus = pgEnum("deployment_status", [
  "cloning",
  "uploading",
  "waiting",
  "active",
  "completed",
  "failed",
]);

/** Deployment status persists independently of BullMQ job retention. */
export const deployments = pgTable("deployments", {
  id: varchar({ length: 5 }).primaryKey(),
  status: deploymentStatus().notNull(),
});
