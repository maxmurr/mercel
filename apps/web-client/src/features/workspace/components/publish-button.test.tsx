import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Toaster } from "@/components/ui/toast";
import { PublishButton } from "@/features/workspace/components/publish-button";

const threadId = "11111111-1111-4111-8111-111111111111";
let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NEXT_PUBLIC_UPLOAD_SERVER_URL", undefined);
  vi.stubEnv("NEXT_PUBLIC_PREVIEW_BASE_URL", undefined);
  fetchMock.mockReset();
  queryClient = new QueryClient();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  queryClient.clear();
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function renderButton(deploymentId?: string) {
  await act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <PublishButton deploymentId={deploymentId} threadId={threadId} />
        <Toaster />
      </QueryClientProvider>
    )
  );
}

async function advanceTime(milliseconds = 10) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

function publishButton() {
  const button = container.querySelector("button");
  if (!button) {
    throw new Error("Publish button not found.");
  }
  return button;
}

async function clickPublish() {
  await act(async () => {
    publishButton().click();
    await vi.advanceTimersByTimeAsync(10);
  });
  await advanceTime();
}

function statusCalls() {
  return fetchMock.mock.calls.filter(
    ([url]) => new URL(String(url), "http://localhost").pathname === "/status"
  );
}

function publishCalls() {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
}

it("publishes once per click, then polls until the site is live", async () => {
  const publish = Promise.withResolvers<Response>();
  fetchMock
    .mockReturnValueOnce(publish.promise)
    .mockResolvedValueOnce(Response.json({ status: "waiting" }))
    .mockResolvedValueOnce(Response.json({ status: "completed" }));
  await renderButton();
  const button = publishButton();
  await act(async () => {
    button.click();
    button.click();
    await vi.advanceTimersByTimeAsync(10);
  });
  await advanceTime();

  expect(publishCalls()).toHaveLength(1);
  expect(fetchMock.mock.calls[0]).toEqual([
    `/api/workspace/${threadId}/publish`,
    { method: "POST" },
  ]);
  expect(button.disabled).toBe(true);
  expect(button.textContent).toBe("Publishing…");
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.querySelector('[data-slot="spinner"]')).not.toBeNull();

  await act(() => publish.resolve(Response.json({ id: "abc12" })));
  await advanceTime();
  await advanceTime();
  expect(statusCalls()).toHaveLength(1);
  expect(button.textContent).toBe("Publishing…");
  expect(container.querySelector("a")).toBeNull();

  await advanceTime(2000);
  expect(statusCalls()).toHaveLength(2);
  const link = container.querySelector("a");
  expect(link?.href).toBe("http://abc12.localhost:3001/");
  expect(link?.textContent).toContain("Open site");
  expect(link?.getAttribute("target")).toBe("_blank");
  expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  expect(publishButton().disabled).toBe(false);
  expect(publishButton().textContent).toBe("Republish");

  await advanceTime(10_000);
  expect(statusCalls()).toHaveLength(2);
  expect(publishCalls()).toHaveLength(1);
});

it("republishes the live site in place and follows the new build", async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json({ status: "completed" }))
    .mockResolvedValueOnce(Response.json({ id: "abc12" }))
    .mockResolvedValueOnce(Response.json({ status: "active" }))
    .mockResolvedValue(Response.json({ status: "completed" }));
  await renderButton("abc12");
  await advanceTime();
  expect(publishButton().textContent).toBe("Republish");

  await clickPublish();

  expect(publishCalls()).toHaveLength(1);
  expect(publishButton().textContent).toBe("Publishing…");
  await advanceTime(2000);
  expect(publishButton().textContent).toBe("Publishing…");

  await advanceTime(2000);
  expect(statusCalls()).toHaveLength(3);
  expect(container.querySelector("a")?.href).toBe(
    "http://abc12.localhost:3001/"
  );
  expect(publishButton().textContent).toBe("Republish");
});

it("reports a failed build and lets the user publish again", async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json({ id: "abc12" }))
    .mockResolvedValueOnce(Response.json({ status: "failed" }))
    .mockResolvedValueOnce(Response.json({ id: "def34" }))
    .mockResolvedValue(Response.json({ status: "completed" }));
  await renderButton();
  await clickPublish();
  await advanceTime();

  expect(document.body.textContent).toContain("Publish failed");
  expect(publishButton().disabled).toBe(false);
  expect(container.querySelector("a")).toBeNull();
  await advanceTime(10_000);
  expect(statusCalls()).toHaveLength(1);

  await clickPublish();
  await advanceTime();
  expect(publishCalls()).toHaveLength(2);
  expect(container.querySelector("a")?.href).toBe(
    "http://def34.localhost:3001/"
  );
});

it("says why publishing could not start and does not poll", async () => {
  fetchMock.mockResolvedValue(
    Response.json({ error: "Nothing to publish yet" }, { status: 404 })
  );
  await renderButton();
  await clickPublish();

  expect(document.body.textContent).toContain("Nothing to publish yet");
  expect(statusCalls()).toHaveLength(0);
  expect(publishButton().disabled).toBe(false);
  expect(publishButton().textContent).toBe("Publish");
});

it("pauses after two status retries and checks the same deployment on demand", async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json({ id: "abc12" }))
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce(Response.json({}, { status: 503 }))
    .mockResolvedValueOnce(Response.json({}, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ status: "active" }))
    .mockResolvedValueOnce(Response.json({ status: "completed" }));
  await renderButton();
  await clickPublish();
  await advanceTime(4000);

  expect(statusCalls()).toHaveLength(3);
  expect(publishButton().textContent).toBe("Check status");
  expect(publishButton().disabled).toBe(false);
  await advanceTime(10_000);
  expect(statusCalls()).toHaveLength(3);

  await clickPublish();
  expect(publishButton().textContent).toBe("Publishing…");
  await advanceTime(2000);
  expect(container.querySelector("a")?.href).toBe(
    "http://abc12.localhost:3001/"
  );
  expect(statusCalls()).toHaveLength(5);
  expect(publishCalls()).toHaveLength(1);
});

it("reopens the thread's last published site without publishing again", async () => {
  fetchMock.mockResolvedValue(Response.json({ status: "completed" }));
  await renderButton("abc12");
  await advanceTime();

  expect(container.querySelector("a")?.href).toBe(
    "http://abc12.localhost:3001/"
  );
  expect(publishCalls()).toHaveLength(0);
  expect(document.body.textContent).not.toContain("Publish failed");
});
