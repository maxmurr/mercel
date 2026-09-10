import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  fetchDeploymentStatus,
  getDeploymentPreviewUrl,
  shouldRetryDeploymentStatus,
  startDeployment,
} from "./deployment";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_UPLOAD_SERVER_URL", undefined);
  vi.stubEnv("NEXT_PUBLIC_PREVIEW_BASE_URL", undefined);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("starts one deployment with JSON and builds its local preview URL", async () => {
  fetchMock.mockResolvedValue(Response.json({ id: "abc12" }));
  expect(
    await startDeployment("https://github.com/maxmurr/vite-react-app.git")
  ).toEqual({
    id: "abc12",
    previewUrl: "http://abc12.localhost:3001/",
  });
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
    new URL("http://localhost:3000/deploy"),
    {
      body: JSON.stringify({
        repoUrl: "https://github.com/maxmurr/vite-react-app.git",
      }),
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }
  );
});

it("rejects a preview sharing the dashboard origin", () => {
  vi.stubGlobal("window", {
    location: { origin: "http://abc12.localhost:3001" },
  });
  expect(() => getDeploymentPreviewUrl("abc12")).toThrow("different origin");
});

it("validates upload origin before sending a request", async () => {
  vi.stubEnv("NEXT_PUBLIC_UPLOAD_SERVER_URL", "file:///tmp/upload");
  await expect(
    startDeployment("https://github.com/maxmurr/vite-react-app.git")
  ).rejects.toThrow("HTTP(S) origin");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("rejects an invalid status ID before fetching", async () => {
  await expect(
    fetchDeploymentStatus("bad/id", new AbortController().signal)
  ).rejects.toThrow("invalid ID");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("preserves configured HTTPS, hostname, and port", async () => {
  vi.stubEnv(
    "NEXT_PUBLIC_PREVIEW_BASE_URL",
    "https://preview.example.com:8443/"
  );
  vi.stubEnv("NEXT_PUBLIC_UPLOAD_SERVER_URL", "https://api.example.com/");
  fetchMock.mockResolvedValue(Response.json({ id: "abc12" }));
  expect(
    await startDeployment("https://github.com/maxmurr/vite-react-app.git")
  ).toEqual({
    id: "abc12",
    previewUrl: "https://abc12.preview.example.com:8443/",
  });
  expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
    "https://api.example.com/deploy"
  );
});

it.each([
  "not a url",
  "javascript:alert(1)",
  "https://user:password@example.com",
  "https://example.com/subpath",
  "https://example.com/?query=1",
  "https://example.com/#fragment",
  "http://127.0.0.1:3001",
  "http://[::1]:3001",
])("rejects invalid preview configuration before POST: %s", async (base) => {
  vi.stubEnv("NEXT_PUBLIC_PREVIEW_BASE_URL", base);
  await expect(
    startDeployment("https://github.com/maxmurr/vite-react-app.git")
  ).rejects.toThrow("Deployment");
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each(["ABCDE", "abc/1", "a.b12", "abc123", ""])(
  "rejects invalid preview ID: %s",
  (id) => {
    expect(() => getDeploymentPreviewUrl(id)).toThrow("invalid ID");
  }
);

it("does not accept a failed POST just because its body contains an ID", async () => {
  fetchMock.mockResolvedValue(Response.json({ id: "abc12" }, { status: 500 }));
  await expect(
    startDeployment("https://github.com/maxmurr/vite-react-app.git")
  ).rejects.toThrow("HTTP 500");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each([null, {}, { id: "INVALID" }])(
  "rejects malformed deployment data: %j",
  async (body) => {
    fetchMock.mockResolvedValue(Response.json(body));
    await expect(
      startDeployment("https://github.com/maxmurr/vite-react-app.git")
    ).rejects.toThrow("outcome is unknown");
  }
);

it("reports unknown POST outcome without replaying a network failure", async () => {
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
  await expect(
    startDeployment("https://github.com/maxmurr/vite-react-app.git")
  ).rejects.toThrow("may create another job");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("rejects invalid POST JSON without replaying the request", async () => {
  fetchMock.mockResolvedValue(new Response("not json"));
  await expect(
    startDeployment("https://github.com/maxmurr/vite-react-app.git")
  ).rejects.toThrow("outcome is unknown");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each(["cloning", "uploading", "waiting", "active", "completed", "failed"])(
  "reads %s without caching and passes cancellation signal",
  async (status) => {
    const { signal } = new AbortController();
    fetchMock.mockResolvedValue(Response.json({ status }));
    expect(await fetchDeploymentStatus("abc12", signal)).toBe(status);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      new URL("http://localhost:3000/status?id=abc12"),
      {
        cache: "no-store",
        credentials: "omit",
        signal,
      }
    );
  }
);

it.each([null, {}, { status: "unknown" }])(
  "rejects malformed status data: %j",
  async (body) => {
    fetchMock.mockResolvedValue(Response.json(body));
    await expect(
      fetchDeploymentStatus("abc12", new AbortController().signal)
    ).rejects.toThrow("status response is invalid");
  }
);

it.each([404, 422, 503])(
  "preserves HTTP %i status failure for retry policy",
  async (status) => {
    fetchMock.mockResolvedValue(
      Response.json({ message: "Unavailable" }, { status })
    );
    await expect(
      fetchDeploymentStatus("abc12", new AbortController().signal)
    ).rejects.toMatchObject({ cause: status });
  }
);

it("retries only transient status failures and stops after two retries", () => {
  for (const error of [
    new TypeError("offline"),
    new Error("unavailable", { cause: 503 }),
  ]) {
    expect(shouldRetryDeploymentStatus(0, error)).toBe(true);
    expect(shouldRetryDeploymentStatus(1, error)).toBe(true);
    expect(shouldRetryDeploymentStatus(2, error)).toBe(false);
  }
  for (const error of [
    new Error("invalid"),
    new SyntaxError("JSON"),
    new Error("not found", { cause: 404 }),
    new Error("invalid ID", { cause: 422 }),
  ]) {
    expect(shouldRetryDeploymentStatus(0, error)).toBe(false);
  }
});
