import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { format } from "date-fns";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ThreadSidebar } from "./thread-sidebar";

const openThreadId = "11111111-1111-4111-8111-111111111111";
const olderThreadId = "22222222-2222-4222-8222-222222222222";
const olderUpdatedAt = "2026-09-10T08:30:00.000Z";

let threadId: string | undefined = openThreadId;
let session: { data: unknown; isPending: boolean } = {
  data: { user: { id: "user-1" } },
  isPending: false,
};

vi.mock("next/navigation", () => ({ useParams: () => ({ threadId }) }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => session },
}));

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
  await act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
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
  threadId = openThreadId;
  session = { data: { user: { id: "user-1" } }, isPending: false };
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

it("lists the account's conversations and marks the open one", async () => {
  await render(<ThreadSidebar />);

  expect(fetchMock).toHaveBeenCalledWith("/api/chat/threads");
  expect(container.querySelector('a[href="/chat"]')?.textContent).toBe(
    "New chat"
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
  await render(<ThreadSidebar />);

  expect(threadLinks()[1]?.textContent).toBe(
    format(new Date(olderUpdatedAt), "d MMM, HH:mm")
  );
});

it("asks a signed-out visitor to sign in without listing anything", async () => {
  session = { data: null, isPending: false };

  await render(<ThreadSidebar />);

  expect(fetchMock).not.toHaveBeenCalled();
  expect(threadLinks()).toHaveLength(0);
  expect(container.textContent).toContain("Sign in to keep your chats.");
});
