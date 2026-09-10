CREATE TYPE "public"."deployment_status" AS ENUM('cloning', 'uploading', 'waiting', 'active', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" varchar(5) PRIMARY KEY NOT NULL,
	"status" "deployment_status" NOT NULL
);
