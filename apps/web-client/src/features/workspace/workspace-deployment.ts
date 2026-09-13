const deploymentIdPattern = /^[a-z0-9]{5}$/;
const ipAddressPattern = /^(?:\d+\.){3}\d+$|:/;

/** Validates deployment endpoint origins before requests or preview URL construction. */
export function readDeploymentOrigin(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error("Deployment endpoint must be an HTTP(S) origin.", {
      cause: error,
    });
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Deployment endpoint must be an HTTP(S) origin without credentials, paths, queries, or fragments."
    );
  }
  return url;
}

/** Validates the preview origin and its support for deployment subdomains. */
export function getDeploymentPreviewBaseUrl() {
  const url = readDeploymentOrigin(
    process.env.NEXT_PUBLIC_PREVIEW_BASE_URL ?? "http://localhost:3001"
  );
  if (ipAddressPattern.test(url.hostname)) {
    throw new Error(
      "Deployment preview base must support subdomains, not an IP address."
    );
  }
  return url;
}

function validateDeploymentId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !deploymentIdPattern.test(id)) {
    throw new Error("Deployment response contains an invalid ID.");
  }
}

/** Reads a validated deployment ID from an upload or publish response. */
export function readDeploymentId(data: unknown) {
  const id =
    data && typeof data === "object" && "id" in data ? data.id : undefined;
  validateDeploymentId(id);
  return id;
}

/** Builds a deployment subdomain URL while preserving the configured protocol and port. */
export function getDeploymentPreviewUrl(id: string) {
  validateDeploymentId(id);
  const url = getDeploymentPreviewBaseUrl();
  url.hostname = `${id}.${url.hostname}`;
  if (typeof window !== "undefined" && url.origin === window.location.origin) {
    throw new Error(
      "Deployment preview must use a different origin from the dashboard."
    );
  }
  return url.href;
}

/**
 * Publishes a thread's sandbox through the app's own route, which archives it
 * and starts the deployment. Non-idempotent: a lost response leaves the outcome
 * unknown, so callers must not retry automatically.
 */
export async function publishWorkspace(threadId: string) {
  const response = await fetch(
    `/api/workspace/${encodeURIComponent(threadId)}/publish`,
    { method: "POST" }
  );
  const data: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String(data.error)
        : `Publish could not be started (HTTP ${response.status}).`;
    throw new Error(message, { cause: response.status });
  }
  const id = readDeploymentId(data);
  return { id, previewUrl: getDeploymentPreviewUrl(id) };
}

/** Reads persisted deployment status without caching; aborting stops observation, not the build. */
export async function fetchDeploymentStatus(id: string, signal: AbortSignal) {
  validateDeploymentId(id);
  const url = new URL(
    "/status",
    readDeploymentOrigin(
      process.env.NEXT_PUBLIC_UPLOAD_SERVER_URL ?? "http://localhost:3000"
    )
  );
  url.searchParams.set("id", id);
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "omit",
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `Deployment status unavailable (HTTP ${response.status}).`,
      {
        cause: response.status,
      }
    );
  }
  const data: unknown = await response.json();
  const status =
    data && typeof data === "object" && "status" in data
      ? data.status
      : undefined;
  switch (status) {
    case "cloning":
    case "uploading":
    case "waiting":
    case "active":
    case "completed":
    case "failed":
      return status;
    default:
      throw new Error("Deployment status response is invalid.");
  }
}

/** Retries status reads twice for network or server errors, never invalid responses or client errors. */
export function shouldRetryDeploymentStatus(
  failureCount: number,
  error: Error
) {
  return (
    failureCount < 2 &&
    (error instanceof TypeError ||
      (typeof error.cause === "number" && error.cause >= 500))
  );
}
