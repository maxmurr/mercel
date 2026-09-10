const deploymentIdPattern = /^[a-z0-9]{5}$/;
const ipAddressPattern = /^(?:\d+\.){3}\d+$|:/;

function readDeploymentOrigin(value: string) {
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

function getPreviewBaseUrl() {
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

/** Builds a deployment subdomain URL while preserving the configured protocol and port. */
export function getDeploymentPreviewUrl(id: string) {
  validateDeploymentId(id);
  const url = getPreviewBaseUrl();
  url.hostname = `${id}.${url.hostname}`;
  if (typeof window !== "undefined" && url.origin === window.location.origin) {
    throw new Error(
      "Deployment preview must use a different origin from the dashboard."
    );
  }
  return url.href;
}

/** Starts one deployment; callers must not automatically retry this non-idempotent request. */
export async function startDeployment(repoUrl: string) {
  const uploadServer = readDeploymentOrigin(
    process.env.NEXT_PUBLIC_UPLOAD_SERVER_URL ?? "http://localhost:3000"
  );
  getPreviewBaseUrl();

  try {
    const response = await fetch(new URL("/deploy", uploadServer), {
      body: JSON.stringify({ repoUrl }),
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(
        `Deployment could not be started (HTTP ${response.status}).`,
        { cause: response.status }
      );
    }
    const data: unknown = await response.json();
    const id =
      data && typeof data === "object" && "id" in data ? data.id : undefined;
    validateDeploymentId(id);
    return { id, previewUrl: getDeploymentPreviewUrl(id) };
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
