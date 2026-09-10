import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import ChatPage from "./page";

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn<typeof fetch>();

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
  fetchMock.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  Reflect.deleteProperty(Element.prototype, "getAnimations");
  vi.unstubAllGlobals();
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

it("allows deployment scripts, assets, and form submissions while keeping preview controls working", async () => {
  await renderPage();
  expect(container.textContent).toContain("UI demo. No AI connected.");
  expect(
    container.querySelector('[role="log"]')?.getAttribute("aria-label")
  ).toBe("Conversation");
  const conversationViewport = container.querySelector(
    '[data-slot="message-scroller-viewport"]'
  );
  expect(conversationViewport?.querySelector('[role="log"]')).not.toBeNull();
  expect(conversationViewport?.getAttribute("tabindex")).toBe("0");
  expect(
    container.querySelectorAll('[data-slot="message-scroller-item"]')
  ).toHaveLength(4);
  expect(
    container.querySelectorAll(
      '[data-slot="message"][data-align="end"] [data-slot="bubble"][data-variant="secondary"]'
    )
  ).toHaveLength(2);
  expect(
    container.querySelectorAll(
      '[data-slot="message"][data-align="start"] [data-slot="bubble"][data-variant="ghost"]'
    )
  ).toHaveLength(2);
  expect(
    container.querySelector('[role="log"] [data-streamdown="strong"]')
      ?.textContent
  ).toBe("skills for your agents");
  expect(
    Array.from(
      container.querySelectorAll('[data-scroll-anchor="true"]'),
      (item) => item.getAttribute("data-message-id")
    )
  ).toEqual(["example-user-1", "example-user-2"]);
  expect(container.querySelectorAll('[role="log"] li')).toHaveLength(3);
  expect(conversationViewport?.classList.contains("scrollbar-subtle")).toBe(
    true
  );
  expect(
    conversationViewport?.classList.contains("motion-reduce:scroll-fade-none")
  ).toBe(true);
  expect(
    container.querySelector('[aria-label="Suggested prompts"]')
  ).toBeNull();
  expect(getTextarea().classList.contains("scrollbar-subtle")).toBe(true);
  const preview = container.querySelector("iframe");
  expect(preview?.getAttribute("src")).toBe("http://lcta6.localhost:3001/");
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
    'a[href="http://lcta6.localhost:3001/"]'
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

it("sends trimmed text and resets without making generation requests", async () => {
  await renderPage();
  await enterMessage("  Build a dashboard\nwith charts  ");
  await clickButton("Send message");
  expect(
    container.querySelectorAll('[data-slot="message"][data-align="end"]')
  ).toHaveLength(3);
  expect(
    Array.from(
      container.querySelectorAll('[data-slot="message"][data-align="end"] p')
    ).at(-1)?.textContent
  ).toBe("Build a dashboard\nwith charts");
  expect(container.textContent).toContain(
    "App generation isn't connected in this demo."
  );
  expect(getTextarea().value).toBe("");
  await clickButton("Preview");
  await clickButton("New chat");
  expect(container.querySelectorAll('[data-slot="message"]')).toHaveLength(0);
  expect(container.textContent).toContain("What can we build together?");
  expect(
    container
      .querySelector("#chat-resizable-panel")
      ?.getAttribute("data-mobile-hidden")
  ).toBe("false");
  expect(getTextarea().value).toBe("");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("preserves drafts and history across panel toggles and preview reloads", async () => {
  await renderPage();
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
  expect(fetchMock).not.toHaveBeenCalled();
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
  expect(
    container.querySelectorAll('[data-slot="message"][data-align="end"]')
  ).toHaveLength(2);
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
  expect(
    container.querySelectorAll('[data-slot="message"][data-align="end"]')
  ).toHaveLength(2);
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
  expect(
    container.querySelectorAll('[data-slot="message"][data-align="end"]')
  ).toHaveLength(2);
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
  expect(
    container.querySelectorAll('[data-slot="message"][data-align="end"]')
  ).toHaveLength(3);
  expect(getTextarea().value).toBe("");
  expect(fetchMock).not.toHaveBeenCalled();
});
