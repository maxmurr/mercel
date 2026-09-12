import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Streamdown } from "streamdown";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatConversation } from "@/components/chat/chat-conversation";
import { ChatHeader } from "@/components/chat/chat-header";
import { ChatPreview } from "@/components/chat/chat-preview";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSandboxStore } from "@/lib/sandbox-store";
import ChatThreadPage from "./page";

const initialThreadId = "11111111-1111-4111-8111-111111111111";
let threadId = initialThreadId;

vi.mock("next/navigation", () => ({
  useParams: () => ({ threadId }),
}));
vi.mock("@/components/chat/chat-composer", { spy: true });
vi.mock("@/components/chat/chat-conversation", { spy: true });
vi.mock("@/components/chat/chat-header", { spy: true });
vi.mock("@/components/chat/chat-preview", { spy: true });
// Stored history loads from the server; these tests drive live chat, so open every thread empty.
vi.mock("@/lib/chat-thread", () => ({
  threadLabel: ({ title }: { title: string }) => title,
  threadListKey: ["chat-threads"],
  threadListOptions: () => ({
    queryFn: () => Promise.resolve([]),
    queryKey: ["chat-threads"],
  }),
  threadOptions: (id: string) => ({
    queryFn: () => Promise.resolve({ messages: [], resourceId: id }),
    queryKey: ["chat-thread", id],
  }),
}));
// The workspace browser fetches on mount; keep those requests out of chat assertions.
vi.mock("@/components/chat/chat-code", () => ({
  ChatCode: () => <p>Workspace files</p>,
}));
// The account menu and thread sidebar resolve a session on mount; keep auth
// requests out of chat assertions.
vi.mock("@/components/user-menu", () => ({ UserMenu: () => null }));
vi.mock("@/components/chat/thread-sidebar", () => ({
  ThreadSidebar: () => null,
}));
vi.mock("streamdown", async (importOriginal) => {
  const original = await importOriginal<typeof import("streamdown")>();
  return {
    ...original,
    Streamdown: vi.fn((props: ComponentProps<typeof original.Streamdown>) => (
      <original.Streamdown {...props} />
    )),
  };
});

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn<typeof fetch>();

function mastraResponse(stream: ReadableStream<unknown>) {
  return new Response(
    stream
      .pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            controller.enqueue(`data: ${JSON.stringify(chunk)}\n\n`);
          },
        })
      )
      .pipeThrough(new TextEncoderStream()),
    {
      headers: { "Content-Type": "text/event-stream" },
    }
  );
}

function chatResponse(text = "A **streamed** reply.") {
  return mastraResponse(
    new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "start" });
        controller.enqueue({ payload: { text }, type: "text-delta" });
        controller.enqueue({ type: "finish" });
        controller.close();
      },
    })
  );
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "Date",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  });
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
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(Element.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
  threadId = initialThreadId;
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => Promise.resolve(chatResponse()));
  useSandboxStore.setState({ lastLogSeq: 0, logs: [], preview: undefined });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  await flushChatUpdates();
  container.remove();
  Reflect.deleteProperty(Element.prototype, "getAnimations");
  Reflect.deleteProperty(Element.prototype, "scrollTo");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// Flush the store's animation-frame batches after React commits connection updates.
async function flushChatUpdates() {
  await act(() => vi.advanceTimersByTimeAsync(50));
}

// The console polls sandbox logs through TanStack Query, so every render needs a client.
async function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>{ui}</TooltipProvider>
      </QueryClientProvider>
    )
  );
}

async function renderPage() {
  await renderWithProviders(<ChatThreadPage key={threadId} />);
  await flushChatUpdates();
}

// The launcher's next prompt opens a fresh thread; render again at that URL.
async function startNewChat() {
  threadId = crypto.randomUUID();
  await renderPage();
}

function getTextarea() {
  const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
  if (!textarea) {
    throw new Error("Chat textarea not found");
  }
  return textarea;
}

async function enterMessage(value: string) {
  const textarea = getTextarea();
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clickButton(label: string) {
  const button = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button")
  ).find(
    (element) =>
      element.getAttribute("aria-label") === label ||
      element.textContent === label
  );
  if (!button) {
    throw new Error(`Chat button not found: ${label}`);
  }
  await act(() => button.click());
  await flushChatUpdates();
}

function getChatRequest(index: number) {
  const call = fetchMock.mock.calls.at(index);
  if (!call) {
    throw new Error("Chat request not found");
  }
  const [url, init] = call;
  return new Request(new URL(String(url), window.location.origin), init);
}

it("starts empty with a placeholder preview and accessible layout", async () => {
  await renderPage();
  expect(container.textContent).toContain("What can we build together?");
  expect(container.textContent).not.toContain("UI demo. No AI connected.");
  const viewport = container.querySelector(
    '[data-slot="message-scroller-viewport"]'
  );
  expect(
    viewport?.querySelector('[role="log"]')?.getAttribute("aria-label")
  ).toBe("Conversation");
  expect(viewport?.getAttribute("tabindex")).toBe("0");
  expect(viewport?.classList.contains("scrollbar-subtle")).toBe(true);
  expect(viewport?.classList.contains("motion-reduce:scroll-fade-none")).toBe(
    true
  );
  expect(getTextarea().classList.contains("scrollbar-subtle")).toBe(true);
  expect(container.querySelector("iframe")).toBeNull();
  expect(container.textContent).toContain("No preview yet");
  const previewUrlInput = container.querySelector<HTMLInputElement>(
    'input[aria-label="Preview URL"]'
  );
  expect(previewUrlInput?.value).toBe("/");
  expect(previewUrlInput?.readOnly).toBe(true);
  expect(
    container.querySelector<HTMLButtonElement>('[aria-label="Reload preview"]')
      ?.disabled
  ).toBe(true);
  const previewLink = container.querySelector(
    '[aria-label="Open preview in new tab"]'
  );
  expect(previewLink?.hasAttribute("href")).toBe(false);
  expect(previewLink?.getAttribute("aria-disabled")).toBe("true");
  expect(container.querySelector("button button, button a")).toBeNull();
  expect(container.textContent).not.toContain("No console output.");
  await clickButton("Console");
  expect(container.textContent).toContain("No console output.");
  expect(
    Array.from(
      container.querySelectorAll('[role="tab"]'),
      (tab) => tab.textContent
    )
  ).toEqual(["Preview", "Code"]);
  await clickButton("Code");
  expect(container.querySelector('input[aria-label="Preview URL"]')).toBe(
    previewUrlInput
  );
  expect(
    container.querySelector('[role="tabpanel"]:not([hidden])')?.textContent
  ).toBe("Workspace files");
  await clickButton("Preview");
  expect(
    container
      .querySelector("#chat-resizable-panel")
      ?.getAttribute("data-mobile-hidden")
  ).toBe("true");
  expect(
    container
      .querySelector("#preview-resizable-panel")
      ?.getAttribute("data-mobile-hidden")
  ).toBe("false");
  await clickButton("Chat");
  expect(
    container
      .querySelector("#chat-resizable-panel")
      ?.getAttribute("data-mobile-hidden")
  ).toBe("false");
  // Opening the console starts polling dev-server logs; nothing else touches the network.
  expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
    "/api/sandbox/logs?after=0",
  ]);
});

it("frames a supplied URL in a sandboxed separate-origin iframe", async () => {
  await renderWithProviders(
<ChatPreview title="Example site" url="http://abc12.localhost:3001/" />
  );
  const preview = container.querySelector("iframe");
  expect(preview?.getAttribute("src")).toBe("http://abc12.localhost:3001/");
  expect(new URL(preview?.src ?? "").origin).not.toBe(window.location.origin);
  expect(preview?.title).toBe("Example site");
  expect(preview?.getAttribute("sandbox")).toBe(
    "allow-scripts allow-same-origin allow-forms"
  );
  expect(preview?.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(container.textContent).not.toContain("No preview yet");
  expect(
    container.querySelector<HTMLInputElement>('input[aria-label="Preview URL"]')
      ?.value
  ).toBe("http://abc12.localhost:3001/");
  const previewLink = container.querySelector(
    'a[href="http://abc12.localhost:3001/"]'
  );
  expect(previewLink?.getAttribute("target")).toBe("_blank");
  expect(previewLink?.getAttribute("rel")).toBe("noopener noreferrer");
  expect(previewLink?.getAttribute("aria-label")).toBe(
    "Open preview in new tab"
  );
  await clickButton("Reload preview");
  expect(container.querySelector("iframe")).not.toBe(preview);
});

it("preserves drafts until the store has connected chat actions", async () => {
  await renderWithProviders(<ChatThreadPage />);
  // The stored thread resolves first; the chat store connects its actions later.
  await act(() => vi.advanceTimersByTimeAsync(0));
  await enterMessage("Early draft");
  expect(
    container.querySelector<HTMLButtonElement>('button[type="submit"]')
      ?.disabled
  ).toBe(true);
  await act(() =>
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  expect(getTextarea().value).toBe("Early draft");
  expect(fetchMock).not.toHaveBeenCalled();
  await flushChatUpdates();
  await clickButton("Send message");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("resizes with the keyboard, stops at a 50/50 split, and collapses at Home", async () => {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(500);
  await renderPage();
  const handle = container.querySelector<HTMLElement>(
    '[aria-label="Resize chat and preview"]'
  );
  expect(handle?.getAttribute("role")).toBe("separator");
  expect(handle?.getAttribute("aria-valuemin")).toBe("0");
  expect(handle?.getAttribute("aria-valuemax")).toBe("50");
  expect(handle?.getAttribute("aria-valuenow")).toBe("40");
  await act(() =>
    handle?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "End" })
    )
  );
  expect(handle?.getAttribute("aria-valuenow")).toBe("50");
  await act(() =>
    handle?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" })
    )
  );
  expect(handle?.getAttribute("aria-valuenow")).toBe("50");
  await act(() =>
    handle?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Home" })
    )
  );
  expect(handle?.getAttribute("aria-valuenow")).toBe("0");
  expect(container.querySelector('[aria-label="Show chat"]')).not.toBeNull();
});

it("collapses and expands the chat panel from the preview toolbar", async () => {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(500);
  await renderPage();
  const handle = container.querySelector<HTMLElement>(
    '[aria-label="Resize chat and preview"]'
  );
  const toggle = container.querySelector('[aria-label="Hide chat"]');
  expect(toggle?.getAttribute("aria-controls")).toBe("chat-panel");
  expect(handle?.getAttribute("aria-valuenow")).toBe("40");
  await clickButton("Hide chat");
  expect(handle?.getAttribute("aria-valuenow")).toBe("0");
  expect(container.querySelector('[aria-label="Hide chat"]')).toBeNull();
  expect(getTextarea().value).toBe("");
  await clickButton("Show chat");
  expect(handle?.getAttribute("aria-valuenow")).toBe("40");
  expect(container.querySelector('[aria-label="Show chat"]')).toBeNull();
});

it("sends the newest message with its memory thread and reuses routing sessions until reset", async () => {
  await renderPage();
  await enterMessage("  Build a dashboard\nwith charts  ");
  await clickButton("Send message");
  const firstRequest = getChatRequest(0);
  expect(firstRequest.url).toBe(
    `${window.location.origin}/api/mastra/agents/agent/stream`
  );
  expect(firstRequest.method).toBe("POST");
  const firstBody = await firstRequest.json();
  expect(firstBody).toMatchObject({
    memory: { resource: initialThreadId, thread: initialThreadId },
    messages: [
      {
        parts: [{ text: "Build a dashboard\nwith charts", type: "text" }],
        role: "user",
      },
    ],
    requestContext: { opencodeSessionId: initialThreadId },
  });
  expect(getTextarea().value).toBe("");
  expect(container.querySelectorAll('[data-slot="message"]')).toHaveLength(2);
  expect(container.querySelector('[data-align="end"] p')?.textContent).toBe(
    "Build a dashboard\nwith charts"
  );
  expect(
    container.querySelector('[role="log"] [data-streamdown="strong"]')
      ?.textContent
  ).toBe("streamed");
  expect(
    container.querySelectorAll('[data-scroll-anchor="true"]')
  ).toHaveLength(1);

  await enterMessage("Add a filter");
  await clickButton("Send message");
  // Mastra replays the thread from storage, so the earlier turn stays off the wire.
  const secondBody = await getChatRequest(1).json();
  expect(secondBody.messages).toEqual([
    expect.objectContaining({
      parts: [{ text: "Add a filter", type: "text" }],
      role: "user",
    }),
  ]);
  expect(secondBody.memory).toEqual(firstBody.memory);
  expect(secondBody.requestContext).toEqual(firstBody.requestContext);

  await clickButton("Preview");
  await startNewChat();
  expect(container.querySelectorAll('[data-slot="message"]')).toHaveLength(0);
  expect(
    container
      .querySelector("#chat-resizable-panel")
      ?.getAttribute("data-mobile-hidden")
  ).toBe("false");
  await enterMessage("New conversation");
  await clickButton("Send message");
  const newBody = await getChatRequest(2).json();
  expect(newBody.messages).toHaveLength(1);
  expect(threadId).not.toBe(initialThreadId);
  expect(newBody.memory).toEqual({ resource: threadId, thread: threadId });
  expect(newBody.requestContext).toEqual({ opencodeSessionId: threadId });
});

it("streams tool calls in order through running, done, failed, and refused states", async () => {
  const stream = new TransformStream<unknown, unknown>();
  const writer = stream.writable.getWriter();
  fetchMock.mockResolvedValueOnce(mastraResponse(stream.readable));
  await renderPage();
  await enterMessage("Fetch the docs");
  await clickButton("Send message");
  await act(async () => {
    await writer.write({
      payload: { id: "t1", text: "Looking." },
      type: "text-delta",
    });
    await writer.write({ payload: { id: "t1" }, type: "text-end" });
    await writer.write({
      payload: { toolCallId: "call-1", toolName: "web_fetch" },
      type: "tool-call-input-streaming-start",
    });
    await vi.advanceTimersByTimeAsync(50);
  });
  await flushChatUpdates();
  const log = () => container.querySelector('[role="log"]');
  const toolParts = () =>
    Array.from(log()?.querySelectorAll('[data-slot="tool-part"]') ?? []);
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(toolParts().map((part) => part.getAttribute("data-status"))).toEqual([
    "running",
  ]);
  expect(toolParts()[0]?.textContent).toBe("web_fetch");
  expect(toolParts()[0]?.querySelector(".shimmer")?.textContent).toBe(
    "web_fetch"
  );

  await act(async () => {
    await writer.write({
      payload: {
        args: { __mastraMetadata: { hidden: true }, url: "https://a.dev" },
        toolCallId: "call-1",
        toolName: "web_fetch",
      },
      type: "tool-call",
    });
    await writer.write({
      payload: {
        result: { status: 200 },
        toolCallId: "call-1",
        toolName: "web_fetch",
      },
      type: "tool-result",
    });
    await writer.write({
      payload: {
        args: { command: "rm -rf ." },
        toolCallId: "call-2",
        toolName: "execute_command",
      },
      type: "tool-call",
    });
    await writer.write({
      payload: {
        error: { message: "Blocked" },
        toolCallId: "call-2",
        toolName: "execute_command",
      },
      type: "tool-error",
    });
    await writer.write({
      payload: {
        args: { path: "a.txt" },
        toolCallId: "call-3",
        toolName: "delete",
      },
      type: "tool-call",
    });
    await writer.write({
      payload: { toolCallId: "call-3", toolName: "delete" },
      type: "tool-output-denied",
    });
    await writer.write({
      payload: {
        args: { objective: "Find fees", query: "Stripe Billing fees" },
        toolCallId: "call-4",
        toolName: "exa_web_search_exa",
      },
      type: "tool-call",
    });
    await writer.write({
      payload: {
        result: "Stripe charges 2.9%.",
        toolCallId: "call-4",
        toolName: "exa_web_search_exa",
      },
      type: "tool-result",
    });
    await writer.write({
      payload: { id: "t2", text: "All done." },
      type: "text-delta",
    });
    await writer.write({ type: "finish" });
    await writer.close();
  });
  await flushChatUpdates();
  expect(toolParts().map((part) => part.getAttribute("data-status"))).toEqual([
    "done",
    "failed",
    "denied",
  ]);
  const reply = log()?.querySelectorAll('[data-slot="message"]')[1];
  expect(reply?.textContent).toBe(
    "Looking.web_fetchexecute_commanddeleteSearched the web for Stripe Billing feesAll done."
  );
  expect(
    reply
      ?.querySelector('[data-status="done"]:not([data-slot="tool-part"])')
      ?.querySelector("svg")
      ?.classList.contains("lucide-globe")
  ).toBe(true);
  const expand = (index: number) =>
    act(() =>
      toolParts()[index]?.querySelector<HTMLButtonElement>("button")?.click()
    );
  const code = (index: number) =>
    toolParts()[index]?.querySelector('[data-streamdown="code-block-body"]')
      ?.textContent;
  await expand(0);
  expect(code(0)).toBe('{  "status": 200}');
  await expand(1);
  expect(code(1)).toBe("Blocked");
  await expand(2);
  expect(code(2)).toBe('{  "path": "a.txt"}');
  // Finished tool calls stay on screen and in storage; the next turn carries only the new message.
  await enterMessage("Thanks");
  await clickButton("Send message");
  expect((await getChatRequest(1).json()).messages).toEqual([
    expect.objectContaining({
      parts: [{ text: "Thanks", type: "text" }],
      role: "user",
    }),
  ]);
  expect(toolParts()).toHaveLength(3);
});

it("renders partial replies and stops streaming without losing drafts", async () => {
  const { promise, resolve } = Promise.withResolvers<Response>();
  fetchMock.mockReturnValueOnce(promise);
  const stream = new TransformStream<unknown, unknown>();
  const writer = stream.writable.getWriter();
  await renderPage();
  await enterMessage("Hello");
  await act(() =>
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  await enterMessage("Next draft");
  await act(() =>
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(getTextarea().value).toBe("Next draft");
  await flushChatUpdates();
  const thinking = container.querySelector('[role="status"]');
  expect(thinking?.textContent).toBe("Thinking…");
  expect(thinking?.querySelector(".shimmer")?.textContent).toBe("Thinking…");
  const spinner = thinking?.firstElementChild;
  expect(spinner?.getAttribute("data-slot")).toBe("spinner");
  expect(spinner?.getAttribute("aria-hidden")).toBe("true");
  expect(spinner?.classList.contains("motion-reduce:animate-none")).toBe(true);
  await enterMessage("Next draft");
  await act(() =>
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(() => resolve(mastraResponse(stream.readable)));
  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    "Thinking…"
  );
  await act(async () => {
    await writer.write({ type: "start" });
    await writer.write({
      payload: { text: "Partial reply" },
      type: "text-delta",
    });
    await vi.advanceTimersByTimeAsync(50);
  });
  await flushChatUpdates();
  expect(container.querySelector('[role="log"]')?.textContent).toContain(
    "Partial reply"
  );
  expect(container.querySelector('[role="status"]')).toBeNull();
  await clickButton("Stop generating");
  expect(getChatRequest(0).signal.aborted).toBe(true);
  expect(getTextarea().value).toBe("Next draft");
  expect(container.querySelector('[role="log"]')?.textContent).toContain(
    "Partial reply"
  );
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("batches rapid code deltas before rendering and keeps the final reply", async () => {
  const stream = new TransformStream<unknown, unknown>();
  const writer = stream.writable.getWriter();
  fetchMock.mockResolvedValueOnce(mastraResponse(stream.readable));
  await renderPage();
  await enterMessage("Can you create simple todo app ?");
  await clickButton("Send message");
  const deltas = [
    "```html\n",
    ...Array.from({ length: 120 }, (_, index) => `<div>Todo ${index}</div>\n`),
    "```",
  ];
  await act(async () => {
    await Promise.all(
      deltas.map((text) =>
        writer.write({
          payload: { text },
          type: "text-delta",
        })
      )
    );
  });
  expect(container.querySelector('[role="log"] code')).toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  await flushChatUpdates();
  expect(container.querySelector('[role="log"] code')?.textContent).toContain(
    "<div>Todo 119</div>"
  );
  await act(async () => {
    await writer.write({
      payload: { text: "\nFinal short tail." },
      type: "text-delta",
    });
    await writer.write({ type: "finish" });
    await writer.close();
  });
  await flushChatUpdates();
  expect(container.querySelector('[aria-label="Stop generating"]')).toBeNull();
  expect(container.querySelector('[role="log"] code')?.textContent).toContain(
    "<div>Todo 119</div>"
  );
  expect(container.querySelector('[role="log"]')?.textContent).toContain(
    "Final short tail."
  );
});

it("isolates draft edits and streamed deltas from layout and completed messages", async () => {
  await renderPage();
  await enterMessage("First turn");
  await clickButton("Send message");

  const stream = new TransformStream<unknown, unknown>();
  const writer = stream.writable.getWriter();
  fetchMock.mockResolvedValueOnce(mastraResponse(stream.readable));
  await enterMessage("Second turn");
  await clickButton("Send message");
  await act(async () => {
    await writer.write({ payload: { text: "Partial" }, type: "text-delta" });
    await vi.advanceTimersByTimeAsync(50);
  });
  await flushChatUpdates();
  const previewUrlInput = container.querySelector(
    'input[aria-label="Preview URL"]'
  );

  vi.mocked(ChatHeader).mockClear();
  vi.mocked(ChatPreview).mockClear();
  vi.mocked(ChatConversation).mockClear();
  vi.mocked(Streamdown).mockClear();
  await enterMessage("Next draft");
  expect(Streamdown).not.toHaveBeenCalled();
  vi.mocked(ChatComposer).mockClear();

  await act(async () => {
    await Promise.all(
      [" reply", " keeps", " streaming"].map((text) =>
        writer.write({ payload: { text }, type: "text-delta" })
      )
    );
    await vi.advanceTimersByTimeAsync(50);
  });
  await flushChatUpdates();

  expect(container.querySelector('[role="log"]')?.textContent).toContain(
    "Partial reply keeps streaming"
  );
  expect(Streamdown).toHaveBeenCalled();
  expect(
    vi
      .mocked(Streamdown)
      .mock.calls.every(([props]) =>
        String(props.children).startsWith("Partial")
      )
  ).toBe(true);
  expect(ChatComposer).not.toHaveBeenCalled();
  expect(ChatConversation).not.toHaveBeenCalled();
  expect(ChatHeader).not.toHaveBeenCalled();
  expect(ChatPreview).not.toHaveBeenCalled();
  expect(container.querySelector('input[aria-label="Preview URL"]')).toBe(
    previewUrlInput
  );
  expect(getTextarea().value).toBe("Next draft");
  await clickButton("Stop generating");
});

it("aborts on navigation and reopens the same thread with an empty store", async () => {
  const { promise, resolve } = Promise.withResolvers<Response>();
  fetchMock.mockReturnValueOnce(promise);
  await renderPage();
  await enterMessage("Leaving now");
  await clickButton("Send message");
  await act(() => root.render(null));
  expect(getChatRequest(0).signal.aborted).toBe(true);
  await renderPage();
  await act(() => resolve(chatResponse("Late reply")));
  await flushChatUpdates();
  expect(container.querySelectorAll('[data-slot="message"]')).toHaveLength(0);
  expect(container.textContent).not.toContain("Late reply");
  expect(getTextarea().value).toBe("");
  await enterMessage("New visit");
  await clickButton("Send message");
  const oldBody = await getChatRequest(0).json();
  const newBody = await getChatRequest(1).json();
  expect(newBody.requestContext).toEqual(oldBody.requestContext);
});

it("aborts a pending reply on reset and ignores its late response", async () => {
  const { promise, resolve } = Promise.withResolvers<Response>();
  fetchMock.mockReturnValueOnce(promise);
  await renderPage();
  await enterMessage("Old conversation");
  await clickButton("Send message");
  await startNewChat();
  expect(getChatRequest(0).signal.aborted).toBe(true);
  await enterMessage("Fresh conversation");
  await clickButton("Send message");
  await act(() => resolve(chatResponse("Stale reply")));
  expect(container.textContent).not.toContain("Stale reply");
  expect(container.textContent).not.toContain("Old conversation");
  expect(container.querySelectorAll('[data-slot="message"]')).toHaveLength(2);
});

it.each(["http", "stream"])(
  "shows %s failures and retries without duplicating the user message",
  async (failure) => {
    fetchMock.mockResolvedValueOnce(
      failure === "http"
        ? new Response("Private provider error", { status: 500 })
        : mastraResponse(
            new ReadableStream({
              start(controller) {
                controller.enqueue({
                  payload: { error: "Private provider error" },
                  type: "error",
                });
                controller.close();
              },
            })
          )
    );
    await renderPage();
    await enterMessage("Try this");
    await clickButton("Send message");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Unable to generate a reply."
    );
    expect(container.textContent).not.toContain("Private provider error");
    expect(container.querySelector('[data-align="end"] p')?.textContent).toBe(
      "Try this"
    );
    await clickButton("Retry");
    const retried = await getChatRequest(1).json();
    expect(retried.messages).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelectorAll('[data-slot="message"]')).toHaveLength(2);
  }
);

it("replaces a failed partial reply on retry without losing the user message", async () => {
  const stream = new TransformStream<unknown, unknown>();
  const writer = stream.writable.getWriter();
  fetchMock.mockResolvedValueOnce(mastraResponse(stream.readable));
  await renderPage();
  await enterMessage("Try this");
  await clickButton("Send message");
  await act(async () => {
    await writer.write({
      payload: { text: "Partial reply" },
      type: "text-delta",
    });
    await vi.advanceTimersByTimeAsync(50);
  });
  await flushChatUpdates();
  expect(container.querySelector('[role="log"]')?.textContent).toContain(
    "Partial reply"
  );
  await act(async () => {
    await writer.write({
      payload: { error: "Private provider error" },
      type: "error",
    });
    await writer.close();
  });
  await flushChatUpdates();
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  await clickButton("Retry");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).not.toContain("Partial reply");
  expect(container.querySelectorAll('[data-slot="message"]')).toHaveLength(2);
  expect((await getChatRequest(1).json()).messages).toHaveLength(1);
});

it("preserves drafts, history, and the preview across panel toggles", async () => {
  await renderPage();
  await enterMessage("Hello");
  await clickButton("Send message");
  const previewUrlInput = container.querySelector<HTMLInputElement>(
    'input[aria-label="Preview URL"]'
  );
  const messages = container.querySelector('[role="log"]')?.textContent;
  await enterMessage("Unsent draft");
  await clickButton("Preview");
  expect(getTextarea().value).toBe("Unsent draft");
  expect(container.querySelector('input[aria-label="Preview URL"]')).toBe(
    previewUrlInput
  );
  await clickButton("Chat");
  expect(getTextarea().value).toBe("Unsent draft");
  expect(container.querySelector('[role="log"]')?.textContent).toBe(messages);
  await startNewChat();
  expect(getTextarea().value).toBe("");
  expect(
    container.querySelector<HTMLInputElement>('input[aria-label="Preview URL"]')
      ?.value
  ).toBe(previewUrlInput?.value);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("opens the preview from a data-preview chunk and logs sandbox output", async () => {
  fetchMock.mockResolvedValueOnce(
    mastraResponse(
      new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "start" });
          controller.enqueue({
            data: { output: "added 68 packages\n", timestamp: 1000 },
            transient: true,
            type: "data-sandbox-stdout",
          });
          controller.enqueue({
            data: { url: "http://localhost:5174" },
            transient: true,
            type: "data-preview",
          });
          controller.enqueue({
            payload: { text: "Live." },
            type: "text-delta",
          });
          controller.enqueue({ type: "finish" });
          controller.close();
        },
      })
    )
  );
  await renderPage();
  await enterMessage("Build it");
  await clickButton("Send message");

  expect(container.querySelector("iframe")?.getAttribute("src")).toBe(
    "http://localhost:5174"
  );
  expect(
    container.querySelector<HTMLInputElement>('input[aria-label="Preview URL"]')
      ?.value
  ).toBe("http://localhost:5174");
  expect(container.querySelector('[role="log"]')?.textContent).toContain(
    "Live."
  );
  await clickButton("Console");
  expect(container.textContent).toContain("added 68 packages");
});

it("rejects blank submits and preserves Shift+Enter and IME composition", async () => {
  await renderPage();
  await enterMessage("   \n  ");
  expect(
    container.querySelector<HTMLButtonElement>('button[type="submit"]')
      ?.disabled
  ).toBe(true);
  await act(() =>
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  expect(fetchMock).not.toHaveBeenCalled();
  await enterMessage("A new message");
  await act(() => {
    for (const options of [
      { shiftKey: true },
      { isComposing: true },
      { keyCode: 229 },
    ]) {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        ...options,
      });
      getTextarea().dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
  });
  await act(() =>
    getTextarea().dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true })
    )
  );
  await act(() =>
    getTextarea().dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      })
    )
  );
  expect(fetchMock).not.toHaveBeenCalled();
  await act(() =>
    getTextarea().dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true })
    )
  );
  await act(() =>
    getTextarea().dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      })
    )
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(getTextarea().value).toBe("");
  await flushChatUpdates();
});

it("shows reasoning while the model thinks and folds it away once the answer arrives", async () => {
  const stream = new TransformStream<unknown, unknown>();
  const writer = stream.writable.getWriter();
  fetchMock.mockResolvedValueOnce(mastraResponse(stream.readable));
  await renderPage();
  await enterMessage("Build billing in-house or buy it?");
  await clickButton("Send message");
  await act(async () => {
    await writer.write({ payload: { id: "r1" }, type: "reasoning-start" });
    await writer.write({
      payload: { id: "r1", text: "Three things decide it." },
      type: "reasoning-delta",
    });
    await vi.advanceTimersByTimeAsync(50);
  });
  await flushChatUpdates();
  const getTrigger = () =>
    container.querySelector<HTMLButtonElement>(
      '[role="log"] [data-slot="collapsible-trigger"]'
    );
  expect(getTrigger()?.textContent).toBe("Reasoning…");
  expect(getTrigger()?.querySelector(".shimmer")?.textContent).toBe(
    "Reasoning…"
  );
  expect(getTrigger()?.getAttribute("aria-expanded")).toBe("true");
  expect(container.querySelector('[role="log"]')?.textContent).toContain(
    "Three things decide it."
  );
  expect(container.querySelector('[role="status"]')).toBeNull();

  await act(async () => {
    await writer.write({ payload: { id: "r1" }, type: "reasoning-end" });
    await writer.write({ payload: { id: "t1" }, type: "text-start" });
    await writer.write({
      payload: { id: "t1", text: "Buy it." },
      type: "text-delta",
    });
    await writer.write({ payload: { id: "t1" }, type: "text-end" });
    await writer.write({ type: "finish" });
    await writer.close();
  });
  await flushChatUpdates();
  expect(getTrigger()?.textContent).toBe("Reasoning");
  expect(getTrigger()?.getAttribute("aria-expanded")).toBe("false");
  expect(container.querySelector('[role="log"]')?.textContent).not.toContain(
    "Three things decide it."
  );
  expect(container.querySelector('[role="log"]')?.textContent).toContain(
    "Buy it."
  );

  await clickButton("Reasoning");
  expect(getTrigger()?.getAttribute("aria-expanded")).toBe("true");
  expect(container.querySelector('[role="log"]')?.textContent).toContain(
    "Three things decide it."
  );
});
