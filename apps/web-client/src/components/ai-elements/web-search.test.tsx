import type { DynamicToolUIPart } from "ai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  isWebSearchPart,
  WebSearchPart,
} from "@/components/ai-elements/web-search";

let container: HTMLDivElement;
let root: Root;

const base = {
  toolCallId: "call-1",
  toolName: "exa_web_search_exa",
  type: "dynamic-tool",
} as const;
const input = { query: "current Stripe Billing pricing and fees" };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function row() {
  const element = container.querySelector<HTMLElement>("[data-status]");
  if (!element) {
    throw new Error("Web search row not found");
  }
  return element;
}

it.each([
  [
    { state: "input-streaming" } as const,
    "running",
    "lucide-loader",
    "Searching the web",
  ],
  [
    { input, state: "input-available" } as const,
    "running",
    "lucide-loader",
    "Searching the web for current Stripe Billing pricing and fees",
  ],
  [
    {
      input,
      output: "Stripe charges 2.9%.",
      state: "output-available",
    } as const,
    "done",
    "lucide-globe",
    "Searched the web for current Stripe Billing pricing and fees",
  ],
  [
    { errorText: "Rate limited", input, state: "output-error" } as const,
    "failed",
    "lucide-triangle-alert",
    "Web search failed",
  ],
])("shows %o as %s", async (state, status, icon, label) => {
  await act(() => root.render(<WebSearchPart part={{ ...base, ...state }} />));
  expect(row().tagName).toBe("DIV");
  expect(row().getAttribute("data-status")).toBe(status);
  expect(row().textContent).toBe(label);
  expect(row().querySelector("svg")?.classList.contains(icon)).toBe(true);
  expect(
    row()
      .querySelector('[data-slot="marker-content"]')
      ?.classList.contains("shimmer")
  ).toBe(status === "running");
  expect(row().classList.contains("text-destructive")).toBe(
    status === "failed"
  );
  expect(container.querySelector("button")).toBeNull();
});

it("recognises only the Exa search tool", () => {
  const part: DynamicToolUIPart = { ...base, input, state: "input-available" };
  expect(isWebSearchPart(part)).toBe(true);
  expect(isWebSearchPart({ ...part, toolName: "web_fetch" })).toBe(false);
  expect(
    isWebSearchPart({
      input,
      state: "input-available",
      toolCallId: "call-2",
      type: "tool-exa_web_search_exa",
    })
  ).toBe(true);
});
