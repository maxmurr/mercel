import { queryOptions, skipToken } from "@tanstack/react-query";

const deploymentIdPattern = /^[a-z0-9]{5}$/;
const ipAddressPattern = /^(?:\d+\.){3}\d+$|:/;
const DEPLOYMENT_POLL_INTERVAL_MS = 2000;

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

function readDeploymentId(data: unknown) {
  const id =
    data && typeof data === "object" && "id" in data ? data.id : undefined;
  validateDeploymentId(id);
  return id;
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

/**
 * Starts one deployment from a gzipped tarball of the project root; callers
 * must not automatically retry this non-idempotent request. Runs on the server,
 * where the files are; the browser goes through `publishWorkspace`.
 */
export async function startDeployment(archive: Blob) {
  const uploadServer = readDeploymentOrigin(
    process.env.NEXT_PUBLIC_UPLOAD_SERVER_URL ?? "http://localhost:3000"
  );
  getPreviewBaseUrl();
  const body = new FormData();
  body.append("archive", archive, "source.tar.gz");

  try {
    const response = await fetch(new URL("/deploy", uploadServer), {
      body,
      credentials: "omit",
      method: "POST",
    });
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

/**
 * Polls a deployment's status every two seconds until it is terminal or a
 * lookup fails for good; `refetch` resumes it. Disabled until there is an ID.
 */
export function deploymentStatusOptions(id: string | undefined) {
  return queryOptions({
    enabled: Boolean(id),
    queryFn: id ? ({ signal }) => fetchDeploymentStatus(id, signal) : skipToken,
    queryKey: ["deployment", id],
    refetchInterval: (query) =>
      query.state.status === "error" ||
      query.state.data === "completed" ||
      query.state.data === "failed"
        ? false
        : DEPLOYMENT_POLL_INTERVAL_MS,
    refetchIntervalInBackground: true,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: shouldRetryDeploymentStatus,
    staleTime: 0,
  });
}
