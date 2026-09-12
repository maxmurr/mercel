import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { threadListKey } from "@/features/chat/chat-cache";
import type { ChatThreadSummary } from "@/features/chat/types/chat-thread";
import { ThreadListClient } from "./thread-list-client";
import { ThreadSidebar } from "./thread-sidebar";

const openThreadId = "11111111-1111-4111-8111-111111111111";
const olderThreadId = "22222222-2222-4222-8222-222222222222";
const olderUpdatedAt = "2026-09-10T08:30:00.000Z";

let queryClient: QueryClient;

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn<typeof fetch>();

function threadListResponse() {
  return Response.json({
    threads: [
      {
        id: openThreadId,
        title: "Landing page for a bakery",
        updatedAt: "2026-09-12T09:00:00.000Z",
      },
      // Mastra's placeholder name survives until title generation lands.
      {
        id: olderThreadId,
        title: "New Thread 2026-09-10T08:30:00.000Z",
        updatedAt: olderUpdatedAt,
      },
    ],
  });
}

async function render(children: ReactNode) {
  const { threads }: { threads: ChatThreadSummary[] } =
    await threadListResponse().json();
  queryClient.setQueryData(threadListKey, threads);
  await act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <SidebarProvider>{children}</SidebarProvider>
      </QueryClientProvider>
    )
  );
  // Let the thread list request settle so rows replace the loading skeleton.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function threadLinks() {
  return [
    ...container.querySelectorAll<HTMLAnchorElement>(
      'a[data-slot="sidebar-menu-button"]'
    ),
  ];
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      addEventListener: vi.fn(),
      matches: false,
      media: query,
      removeEventListener: vi.fn(),
    }))
  );
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  });
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => Promise.resolve(threadListResponse()));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("shows server-seeded conversations without another request and marks the open one", async () => {
  await render(
    <ThreadSidebar>
      <ThreadListClient threadId={openThreadId} />
    </ThreadSidebar>
  );

  expect(fetchMock).not.toHaveBeenCalled();
  expect(container.querySelector('a[href="/chat"]')?.textContent).toBe(
    "New Chat"
  );
  const links = threadLinks();
  expect(links.map((link) => link.getAttribute("href"))).toEqual([
    `/chat/${openThreadId}`,
    `/chat/${olderThreadId}`,
  ]);
  expect(links[0]?.textContent).toBe("Landing page for a bakery");
  expect(links.map((link) => link.hasAttribute("data-active"))).toEqual([
    true,
    false,
  ]);
});

it("dates a thread whose title has not been generated yet", async () => {
  await render(
    <ThreadSidebar>
      <ThreadListClient threadId={openThreadId} />
    </ThreadSidebar>
  );

  expect(threadLinks()[1]?.textContent).toBe("2026-09-10 08:30 UTC");
});

it("revalidates the seeded list after a completed turn", async () => {
  await render(
    <ThreadSidebar>
      <ThreadListClient threadId={openThreadId} />
    </ThreadSidebar>
  );
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: threadListKey });
  });
  expect(fetchMock).toHaveBeenCalledWith("/api/chat/threads");
  expect(threadLinks()).toHaveLength(2);
});
