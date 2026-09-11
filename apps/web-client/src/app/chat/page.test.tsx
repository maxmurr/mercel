import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import ChatPage from "./page";

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn<typeof fetch>();
const sessionIdPattern = /^[0-9a-f-]{36}$/;

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
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => Promise.resolve(chatResponse()));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  Reflect.deleteProperty(Element.prototype, "getAnimations");
  Reflect.deleteProperty(Element.prototype, "scrollTo");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function renderPage() {
  await act(() =>
    root.render(
      <TooltipProvider>
        <ChatPage />
      </TooltipProvider>
    )
  );
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
}

function getChatRequest(index: number) {
  const call = fetchMock.mock.calls.at(index);
  if (!call) {
    throw new Error("Chat request not found");
  }
  const [url, init] = call;
  return new Request(new URL(String(url), window.location.origin), init);
}

it("starts empty and keeps the separate-origin preview and accessible layout", async () => {
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
  const preview = container.querySelector("iframe");
  expect(preview?.getAttribute("src")).toBe("http://yoopy.localhost:3001/");
  expect(new URL(preview?.src ?? "").origin).not.toBe(window.location.origin);
  expect(preview?.title).toBe("Agent skills example website");
  expect(preview?.getAttribute("sandbox")).toBe(
    "allow-scripts allow-same-origin allow-forms"
  );
  expect(preview?.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(
    container.querySelector<HTMLInputElement>('input[aria-label="Preview URL"]')
      ?.readOnly
  ).toBe(true);
  const previewLink = container.querySelector(
    'a[href="http://yoopy.localhost:3001/"]'
  );
  expect(previewLink?.getAttribute("target")).toBe("_blank");
  expect(previewLink?.getAttribute("rel")).toBe("noopener noreferrer");
  expect(previewLink?.getAttribute("aria-label")).toBe(
    "Open preview in new tab"
  );
  expect(container.querySelector("button button, button a")).toBeNull();
  await clickButton("Reload preview");
  expect(container.querySelector("iframe")).not.toBe(preview);
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
  expect(fetchMock).not.toHaveBeenCalled();
});

it("resizes with the keyboard and stops at a 50/50 split", async () => {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(500);
  await renderPage();
  const handle = container.querySelector<HTMLElement>(
    '[aria-label="Resize chat and preview"]'
  );
  expect(handle?.getAttribute("role")).toBe("separator");
  expect(handle?.getAttribute("aria-valuemin")).toBe("25");
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
  expect(handle?.getAttribute("aria-valuenow")).toBe("25");
});

it("sends UI messages, renders markdown, and reuses history and routing sessions until reset", async () => {
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
    messages: [
      {
        parts: [{ text: "Build a dashboard\nwith charts", type: "text" }],
        role: "user",
      },
    ],
    requestContext: {
      opencodeSessionId: expect.stringMatching(sessionIdPattern),
    },
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
  const secondBody = await getChatRequest(1).json();
  expect(secondBody.messages).toHaveLength(3);
  expect(secondBody.messages[1]).toMatchObject({
    parts: expect.arrayContaining([
      expect.objectContaining({ text: "A **streamed** reply.", type: "text" }),
    ]),
    role: "assistant",
  });
  expect(secondBody.requestContext).toEqual(firstBody.requestContext);

  await clickButton("Preview");
  await clickButton("New chat");
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
  expect(newBody.requestContext.opencodeSessionId).not.toBe(
    firstBody.requestContext.opencodeSessionId
  );
});

it("renders partial replies and stops streaming without losing drafts", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const { promise, resolve } = Promise.withResolvers<Response>();
  fetchMock.mockReturnValueOnce(promise);
  const stream = new TransformStream<unknown, unknown>();
  const writer = stream.writable.getWriter();
  await renderPage();
  await enterMessage("Hello");
  await clickButton("Send message");
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
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
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
  expect(container.querySelector('[role="log"] code')?.textContent).toContain(
    "<div>Todo 119</div>"
  );
  await act(async () => {
    await writer.write({ type: "finish" });
    await writer.close();
  });
  expect(container.querySelector('[aria-label="Stop generating"]')).toBeNull();
  expect(container.querySelector('[role="log"] code')?.textContent).toContain(
    "<div>Todo 119</div>"
  );
});

it("aborts a pending reply on reset and ignores its late response", async () => {
  const { promise, resolve } = Promise.withResolvers<Response>();
  fetchMock.mockReturnValueOnce(promise);
  await renderPage();
  await enterMessage("Old conversation");
  await clickButton("Send message");
  await clickButton("New chat");
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

it("preserves drafts and history across panel toggles and preview reloads", async () => {
  await renderPage();
  await enterMessage("Hello");
  await clickButton("Send message");
  const preview = container.querySelector("iframe");
  const messages = container.querySelector('[role="log"]')?.textContent;
  await enterMessage("Unsent draft");
  await clickButton("Preview");
  expect(getTextarea().value).toBe("Unsent draft");
  expect(container.querySelector("iframe")).toBe(preview);
  await clickButton("Reload preview");
  const reloadedPreview = container.querySelector("iframe");
  expect(reloadedPreview).not.toBe(preview);
  await clickButton("Chat");
  expect(getTextarea().value).toBe("Unsent draft");
  expect(container.querySelector('[role="log"]')?.textContent).toBe(messages);
  await clickButton("New chat");
  expect(getTextarea().value).toBe("");
  expect(container.querySelector("iframe")).toBe(reloadedPreview);
  expect(fetchMock).toHaveBeenCalledTimes(1);
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
});
