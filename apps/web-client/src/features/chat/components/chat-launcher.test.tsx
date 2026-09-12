import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { takePendingPrompt } from "@/features/chat/chat-pending-prompt";
import { ChatLauncher } from "./chat-launcher";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

let container: HTMLDivElement;
let root: Root;
const threadHrefPattern = /^\/chat\/[0-9a-f-]{36}$/;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root.render(<ChatLauncher />));
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function getTextarea() {
  const textarea = container.querySelector("textarea");
  if (!textarea) {
    throw new Error("Launcher textarea not found");
  }
  return textarea;
}

function getSubmitButton() {
  const button = container.querySelector<HTMLButtonElement>(
    'button[type="submit"]'
  );
  if (!button) {
    throw new Error("Launcher submit button not found");
  }
  return button;
}

async function type(text: string) {
  const textarea = getTextarea();
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set?.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("opens a thread carrying the trimmed prompt", async () => {
  await type("  Build me a landing page  ");
  expect(getSubmitButton().disabled).toBe(false);

  await act(() => getSubmitButton().click());

  expect(push).toHaveBeenCalledTimes(1);
  const href = push.mock.calls[0]?.[0] as string;
  expect(href).toMatch(threadHrefPattern);
  expect(takePendingPrompt(href.slice("/chat/".length))).toBe(
    "Build me a landing page"
  );
  // The prompt is claimed once, so a reconnecting thread never resends it.
  expect(takePendingPrompt(href.slice("/chat/".length))).toBe("");
});

it("sends on Enter but keeps Shift+Enter for new lines", async () => {
  await type("Ship it");
  await act(() => {
    getTextarea().dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "Enter",
        shiftKey: true,
      })
    );
  });
  expect(push).not.toHaveBeenCalled();

  await act(() => {
    getTextarea().dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })
    );
  });
  expect(push).toHaveBeenCalledTimes(1);
});

it("refuses to open a thread for whitespace", async () => {
  await type("   ");
  expect(getSubmitButton().disabled).toBe(true);

  await act(() => {
    getTextarea().dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })
    );
  });
  expect(push).not.toHaveBeenCalled();
});
