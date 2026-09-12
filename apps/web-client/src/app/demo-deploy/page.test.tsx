import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NewProjectForm } from "@/components/new-project/new-project-form";
import { TooltipProvider } from "@/components/ui/tooltip";
import HomePage from "./page";

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
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Number.POSITIVE_INFINITY, staleTime: 60_000 },
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  queryClient.clear();
  container.remove();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function renderPage(children: ReactNode = <HomePage />) {
  await act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    )
  );
}

async function advanceTime(milliseconds = 10) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

async function clickButton(
  button = container.querySelector<HTMLButtonElement>("button[form]")
) {
  expect(button).not.toBeNull();
  await act(async () => {
    button?.click();
    await vi.advanceTimersByTimeAsync(10);
  });
  await advanceTime();
}

async function enterRepository(
  repoUrl = "https://github.com/example/my-app",
  input = container.querySelector<HTMLInputElement>('input[name="repoUrl"]')
) {
  if (!input) {
    throw new Error("Repository input not found.");
  }
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set?.call(input, repoUrl);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function getStatusCalls() {
  return fetchMock.mock.calls.filter(
    ([url]) => new URL(String(url)).pathname === "/status"
  );
}

it("starts with an empty repository and keeps fixed settings disabled, labeled, and keyboard accessible", async () => {
  await renderPage();
  const repositoryInput = container.querySelector<HTMLInputElement>(
    'input[name="repoUrl"]'
  );
  expect(repositoryInput?.value).toBe("");
  expect(repositoryInput?.disabled).toBe(false);
  expect(repositoryInput?.labels?.length).toBe(1);
  expect(repositoryInput?.required).toBe(true);
  const inputs =
    container.querySelectorAll<HTMLInputElement>('input[type="text"]');
  expect(
    Array.from(inputs, (input) => ({
      disabled: input.disabled,
      labels: input.labels?.length,
      name: input.name,
      value: input.value,
    }))
  ).toEqual([
    { disabled: true, labels: 1, name: "applicationPreset", value: "Vite" },
    { disabled: true, labels: 1, name: "rootDirectory", value: "./" },
    { disabled: true, labels: 1, name: "buildCommand", value: "npm run build" },
    { disabled: true, labels: 1, name: "outputDirectory", value: "dist" },
    {
      disabled: true,
      labels: 1,
      name: "installCommand",
      value: "npm ci --include=dev",
    },
  ]);
  expect(container.querySelector('[role="switch"]')).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
  const trigger = container.querySelector<HTMLButtonElement>(
    '[data-slot="collapsible-trigger"]'
  );
  expect(trigger?.getAttribute("aria-expanded")).toBe("true");
  await act(() => trigger?.focus());
  expect(document.activeElement).toBe(trigger);
  await act(() => trigger?.click());
  expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  await act(() => trigger?.click());
  expect(trigger?.getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(trigger);
});

it.each([
  "",
  "   ",
  "not-a-url",
  "https://github.com/owner",
  "https://github.com/owner/repo/tree/main",
  "https://github.com/owner/repo?token=secret",
  "https://github.com.evil.test/owner/repo",
  "https://user:token@github.com/owner/repo",
  "http://github.com/owner/repo",
  "file:///tmp/repo",
])("rejects invalid repository URL %j before deployment", async (repoUrl) => {
  await renderPage();
  await enterRepository(repoUrl);
  await clickButton();
  expect(fetchMock).not.toHaveBeenCalled();
  const input = container.querySelector<HTMLInputElement>(
    'input[name="repoUrl"]'
  );
  expect(input?.getAttribute("aria-invalid")).toBe("true");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Enter a GitHub URL"
  );
  await act(() =>
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

it("clears repository validation errors and deploys a corrected URL", async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json({ id: "abc12" }))
    .mockResolvedValueOnce(Response.json({ status: "completed" }));
  await renderPage();
  await clickButton();
  await enterRepository("https://github.com/example/my-app");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  await clickButton();
  expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
    JSON.stringify({ repoUrl: "https://github.com/example/my-app" })
  );
  expect(container.querySelector("iframe")?.title).toBe(
    "example/my-app deployment preview"
  );
});

it("blocks rapid clicks and repeated submits while upload is pending, then polls until preview is ready", async () => {
  const upload = Promise.withResolvers<Response>();
  fetchMock
    .mockReturnValueOnce(upload.promise)
    .mockResolvedValueOnce(Response.json({ status: "waiting" }))
    .mockResolvedValueOnce(Response.json({ status: "active" }))
    .mockResolvedValueOnce(Response.json({ status: "completed" }));
  await renderPage();
  await enterRepository("https://github.com/acme/custom-app.git");
  const button = container.querySelector<HTMLButtonElement>(
    'button[type="submit"]'
  );
  await act(() => {
    button?.click();
    button?.click();
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await advanceTime();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
    body: JSON.stringify({
      repoUrl: "https://github.com/acme/custom-app.git",
    }),
    method: "POST",
  });
  expect(button?.disabled).toBe(true);
  expect(
    container.querySelector<HTMLInputElement>('input[name="repoUrl"]')?.disabled
  ).toBe(true);
  expect(button?.textContent).toBe("Deploying...");
  expect(button?.getAttribute("aria-busy")).toBe("true");
  expect(button?.querySelector('[data-slot="spinner"]')).not.toBeNull();
  expect(container.querySelector("iframe")).toBeNull();
  await advanceTime(6000);
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await act(() => upload.resolve(Response.json({ id: "abc12" })));
  await advanceTime();
  await advanceTime();
  expect(getStatusCalls()).toHaveLength(1);
  expect(button?.disabled).toBe(true);
  await act(() =>
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  expect(
    fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")
  ).toHaveLength(1);
  await advanceTime(2000);
  expect(getStatusCalls()).toHaveLength(2);
  expect(container.querySelector("iframe")).toBeNull();
  await advanceTime(2000);
  const heading = container.querySelector("h1");
  expect(heading?.textContent).toBe("Congratulations!");
  expect(document.activeElement).toBe(heading);
  expect(container.querySelector("form")).toBeNull();
  const preview = container.querySelector("iframe");
  expect(preview?.src).toBe("http://abc12.localhost:3001/");
  expect(preview?.title).toBe("acme/custom-app deployment preview");
  expect(preview?.getAttribute("sandbox")).toBe(
    "allow-scripts allow-same-origin"
  );
  expect(preview?.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(preview?.getAttribute("scrolling")).toBe("no");
  expect(preview?.closest("a")).toBeNull();
  expect(preview?.classList.contains("scheme-only-dark")).toBe(true);
  expect(preview?.classList.contains("pointer-events-none")).toBe(true);
  expect(preview?.tabIndex).toBe(-1);
  expect(preview?.getAttribute("aria-hidden")).toBe("true");
  expect(preview?.parentElement?.classList.contains("relative")).toBe(true);
  const link = container.querySelector(
    'a[href="http://abc12.localhost:3001/"]'
  );
  expect(link?.textContent).toBe("Open site");
  expect(link?.classList.contains("after:absolute")).toBe(true);
  expect(link?.classList.contains("after:inset-0")).toBe(true);
  expect(link?.getAttribute("target")).toBe("_blank");
  expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  expect(container.querySelector('a[href="https://vercel.com"]')).toBeNull();
  await act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
  });
  await advanceTime(10_000);
  expect(getStatusCalls()).toHaveLength(3);
});

it("keeps form instances and deployment IDs independent and handles immediate completion", async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json({ id: "abc12" }))
    .mockResolvedValueOnce(Response.json({ status: "completed" }))
    .mockResolvedValueOnce(Response.json({ id: "def34" }))
    .mockResolvedValue(Response.json({ status: "waiting" }));
  await renderPage(
    <>
      <NewProjectForm className="max-w-sm" />
      <NewProjectForm className="max-w-md" />
    </>
  );
  expect(container.children.item(0)?.classList.contains("max-w-sm")).toBe(true);
  expect(container.children.item(1)?.classList.contains("max-w-md")).toBe(true);
  const ids = Array.from(
    container.querySelectorAll("[id]"),
    (element) => element.id
  );
  expect(new Set(ids).size).toBe(ids.length);
  expect(
    Array.from(
      container.querySelectorAll<HTMLInputElement>("input"),
      (input) => input.labels?.length
    )
  ).toEqual(Array.from({ length: 12 }, () => 1));
  const repositoryInputs = container.querySelectorAll<HTMLInputElement>(
    'input[name="repoUrl"]'
  );
  await enterRepository(
    "https://github.com/first/project",
    repositoryInputs.item(0)
  );
  await enterRepository(
    "https://github.com/second/project",
    repositoryInputs.item(1)
  );
  await clickButton(
    container
      .querySelectorAll<HTMLButtonElement>('button[type="submit"]')
      .item(1)
  );
  expect(
    Array.from(
      container.querySelectorAll("h1"),
      (heading) => heading.textContent
    )
  ).toEqual(["New Project", "Congratulations!"]);
  expect(container.querySelectorAll("form")).toHaveLength(1);
  expect(container.querySelector("iframe")?.title).toBe(
    "second/project deployment preview"
  );
  await clickButton();
  expect(
    fetchMock.mock.calls
      .filter(([, options]) => options?.method === "POST")
      .map(([, options]) => options?.body)
  ).toEqual([
    JSON.stringify({ repoUrl: "https://github.com/second/project" }),
    JSON.stringify({ repoUrl: "https://github.com/first/project" }),
  ]);
  expect(
    getStatusCalls().map(([url]) => new URL(String(url)).searchParams.get("id"))
  ).toEqual(["abc12", "def34"]);
  expect(container.querySelectorAll("iframe")).toHaveLength(1);
  expect(container.querySelector("button[form]")?.textContent).toBe(
    "Deploying..."
  );
});

it.each(["cloning", "uploading"])(
  "keeps polling nonterminal %s status",
  async (status) => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ id: "abc12" }))
      .mockResolvedValue(Response.json({ status }));
    await renderPage();
    await enterRepository();
    await clickButton();
    await advanceTime(2000);
    expect(getStatusCalls()).toHaveLength(2);
    expect(container.querySelector("button[form]")?.textContent).toBe(
      "Deploying..."
    );
    expect(container.querySelector("iframe")).toBeNull();
  }
);

it("stops at failed status and allows an explicit new deployment with fresh state", async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json({ id: "abc12" }))
    .mockResolvedValueOnce(Response.json({ status: "failed" }))
    .mockResolvedValueOnce(Response.json({ id: "def34" }))
    .mockResolvedValueOnce(Response.json({ status: "completed" }));
  await renderPage();
  await enterRepository();
  await clickButton();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Deployment failed"
  );
  expect(container.querySelector("iframe")).toBeNull();
  await act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
  });
  await advanceTime(10_000);
  expect(getStatusCalls()).toHaveLength(1);
  expect(
    container.querySelector<HTMLInputElement>('input[name="repoUrl"]')?.disabled
  ).toBe(false);
  await enterRepository("https://github.com/another/repo/");
  await clickButton();
  expect(container.querySelector("iframe")?.title).toBe(
    "another/repo deployment preview"
  );
  expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(
    JSON.stringify({ repoUrl: "https://github.com/another/repo/" })
  );
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector("iframe")?.src).toBe(
    "http://def34.localhost:3001/"
  );
  expect(
    fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")
  ).toHaveLength(2);
});

it.each([500, 422])(
  "shows failed POST HTTP %i without polling or replaying its ID",
  async (status) => {
    fetchMock.mockResolvedValue(Response.json({ id: "abc12" }, { status }));
    await renderPage();
    await enterRepository();
    await clickButton();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      `HTTP ${status}`
    );
    expect(
      container.querySelector<HTMLButtonElement>("button[form]")?.disabled
    ).toBe(false);
    expect(container.querySelector("iframe")).toBeNull();
    await advanceTime(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }
);

it("reports unknown POST outcome on network failure without automatic replay", async () => {
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
  await renderPage();
  await enterRepository();
  await clickButton();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "may create another job"
  );
  await advanceTime(10_000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.querySelector("iframe")).toBeNull();
});

it.each([{}, { id: "wrong-id" }])(
  "rejects malformed successful POST data %j without polling",
  async (body) => {
    fetchMock.mockResolvedValue(Response.json(body));
    await renderPage();
    await enterRepository();
    await clickButton();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(getStatusCalls()).toHaveLength(0);
  }
);

it("recovers from a transient status error without another POST", async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json({ id: "abc12" }))
    .mockResolvedValueOnce(Response.json({}, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ status: "completed" }));
  await renderPage();
  await enterRepository();
  await clickButton();
  expect(container.querySelector("button[form]")?.textContent).toBe(
    "Deploying..."
  );
  await advanceTime(1000);
  expect(container.querySelector("iframe")).not.toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it("pauses after two status retries, then checks same ID and resumes polling without deploying again", async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json({ id: "abc12" }))
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce(Response.json({}, { status: 503 }))
    .mockResolvedValueOnce(Response.json({}, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ status: "active" }))
    .mockResolvedValueOnce(Response.json({ status: "completed" }));
  await renderPage();
  await enterRepository();
  await clickButton();
  await advanceTime(4000);
  expect(getStatusCalls()).toHaveLength(3);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "may still be running"
  );
  expect(container.querySelector("button[form]")?.textContent).toBe(
    "Check status"
  );
  expect(
    container.querySelector<HTMLInputElement>('input[name="repoUrl"]')?.disabled
  ).toBe(true);
  await advanceTime(10_000);
  expect(getStatusCalls()).toHaveLength(3);
  await act(() =>
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  expect(fetchMock).toHaveBeenCalledTimes(4);
  await clickButton();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector("button[form]")?.textContent).toBe(
    "Deploying..."
  );
  await advanceTime(2000);
  expect(container.querySelector("iframe")).not.toBeNull();
  expect(getStatusCalls()).toHaveLength(5);
  expect(
    getStatusCalls().every(
      ([url]) => new URL(String(url)).searchParams.get("id") === "abc12"
    )
  ).toBe(true);
  expect(
    fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")
  ).toHaveLength(1);
});

it.each([404, 422, "unknown", "invalid-json"])(
  "stops without retry for status response %s",
  async (outcome) => {
    let response = Response.json({ status: outcome });
    if (typeof outcome === "number") {
      response = Response.json({}, { status: outcome });
    } else if (outcome === "invalid-json") {
      response = new Response("not JSON");
    }
    fetchMock
      .mockResolvedValueOnce(Response.json({ id: "abc12" }))
      .mockResolvedValue(response);
    await renderPage();
    await enterRepository();
    await clickButton();
    await advanceTime(10_000);
    expect(getStatusCalls()).toHaveLength(1);
    expect(container.querySelector("button[form]")?.textContent).toBe(
      "Check status"
    );
    expect(container.querySelector("iframe")).toBeNull();
  }
);

it("aborts a pending status read and stops polling when form unmounts", async () => {
  const status = Promise.withResolvers<Response>();
  fetchMock
    .mockResolvedValueOnce(Response.json({ id: "abc12" }))
    .mockReturnValueOnce(status.promise);
  await renderPage();
  await enterRepository();
  await clickButton();
  const signal = getStatusCalls()[0]?.[1]?.signal;
  expect(signal?.aborted).toBe(false);
  await renderPage(null);
  expect(signal?.aborted).toBe(true);
  await act(() => status.resolve(Response.json({ status: "completed" })));
  await advanceTime(10_000);
  expect(getStatusCalls()).toHaveLength(1);
  expect(container.querySelector("iframe")).toBeNull();
});
