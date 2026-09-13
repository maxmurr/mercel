import "server-only";

import {
  getDeploymentPreviewBaseUrl,
  readDeploymentId,
  readDeploymentOrigin,
} from "./workspace-deployment";

/**
 * Starts a deployment from a gzipped project archive. Callers must verify thread
 * ownership and take republish IDs only from stored thread metadata.
 * Never automatically retry this non-idempotent request.
 */
export async function startDeployment(archive: Blob, id?: string) {
  const token = process.env.DEPLOY_TOKEN;
  if (!token?.trim()) {
    throw new Error("Deployment authentication missing: set DEPLOY_TOKEN.");
  }
  const uploadServer = readDeploymentOrigin(
    process.env.NEXT_PUBLIC_UPLOAD_SERVER_URL ?? "http://localhost:3000"
  );
  getDeploymentPreviewBaseUrl();
  const body = new FormData();
  body.append("archive", archive, "source.tar.gz");
  if (id !== undefined) {
    body.append("id", readDeploymentId({ id }));
  }

  try {
    const response = await fetch(new URL("/deploy", uploadServer), {
      body,
      credentials: "omit",
      headers: { Authorization: `Bearer ${token}` },
      method: "POST",
      redirect: "error",
    });
    if (response.status === 409) {
      throw new Error(
        "This site is already publishing. Wait for it to finish, then publish again.",
        { cause: response.status }
      );
    }
    if (!response.ok) {
      throw new Error(
        `Deployment could not be started (HTTP ${response.status}).`,
        { cause: response.status }
      );
    }
    return { id: readDeploymentId(await response.json()) };
  } catch (error) {
    if (error instanceof Error && typeof error.cause === "number") {
      throw error;
    }
    throw new Error(
      "Deployment outcome is unknown. Deploying again may create another job.",
      { cause: error }
    );
  }
}
