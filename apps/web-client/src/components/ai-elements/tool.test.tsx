import type { DynamicToolUIPart } from "ai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToolPart } from "@/components/ai-elements/tool";

let container: HTMLDivElement;
let root: Root;
const writeText = vi.fn(() => Promise.resolve());

const base = { toolCallId: "call-1", toolName: "web_fetch" } as const;
const input = { url: "https://example.com" };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  writeText.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(part: DynamicToolUIPart) {
  await act(() => root.render(<ToolPart part={part} />));
}

function trigger() {
  const button = container.querySelector<HTMLButtonElement>(
    '[data-slot="marker"]'
  );
  if (!button) {
    throw new Error("Tool trigger not found");
  }
  return button;
}

function code() {
  return container.querySelector('[data-streamdown="code-block-body"]')
    ?.textContent;
}

it.each([
  [{ state: "input-streaming" } as const, "running", "lucide-loader"],
  [{ input, state: "input-available" } as const, "running", "lucide-loader"],
  [
    { input, output: { status: 200 }, state: "output-available" } as const,
    "done",
    "lucide-check",
  ],
  [
    { errorText: "Timed out", input, state: "output-error" } as const,
    "failed",
    "lucide-triangle-alert",
  ],
  [
    {
      approval: { approved: false, id: "a1", reason: "Not allowed" },
      input,
      state: "output-denied",
    } as const,
    "denied",
    "lucide-shield-x",
  ],
])("shows %o as %s", async (state, status, icon) => {
  await render({ type: "dynamic-tool", ...base, ...state });
  const part = container.querySelector('[data-slot="tool-part"]');
  expect(part?.getAttribute("data-status")).toBe(status);
  expect(trigger().tagName).toBe("BUTTON");
  expect(trigger().textContent).toBe("web_fetch");
  expect(trigger().querySelector("svg")?.classList.contains(icon)).toBe(true);
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  expect(
    trigger()
      .querySelector('[data-slot="marker-content"]')
      ?.classList.contains("shimmer")
  ).toBe(status === "running");
  expect(part?.classList.contains("border")).toBe(false);
  expect(code()).toBeUndefined();
});

it("expands to a copyable code block showing the output, the error, or the input", async () => {
  await render({
    input,
    output: { status: 200 },
    state: "output-available",
    type: "dynamic-tool",
    ...base,
  });
  await act(() => trigger().click());
  expect(trigger().getAttribute("aria-expanded")).toBe("true");
  expect(code()).toBe('{  "status": 200}');
  const copy = container.querySelector<HTMLButtonElement>(
    '[data-streamdown="code-block-copy-button"]'
  );
  await act(async () => {
    copy?.click();
    await Promise.resolve();
  });
  expect(writeText).toHaveBeenCalledWith(
    JSON.stringify({ status: 200 }, null, 2)
  );

  await render({
    errorText: "Timed out",
    input,
    state: "output-error",
    type: "dynamic-tool",
    ...base,
  });
  expect(code()).toBe("Timed out");

  await render({
    approval: { approved: false, id: "a1", reason: "Not allowed" },
    input,
    state: "output-denied",
    type: "dynamic-tool",
    ...base,
  });
  expect(code()).toBe('{  "url": "https://example.com"}');
});

it("keeps the arguments open and offers approve or decline while approval is pending", async () => {
  const onApprovalResponse = vi.fn();
  const approvalRequested = {
    approval: { id: "run-1::call-1" },
    input,
    state: "approval-requested",
    type: "dynamic-tool",
    ...base,
  } as const;
  await act(() =>
    root.render(
      <ToolPart
        onApprovalResponse={onApprovalResponse}
        part={approvalRequested}
      />
    )
  );
  expect(
    container
      .querySelector('[data-slot="tool-part"]')
      ?.getAttribute("data-status")
  ).toBe("pending");
  expect(trigger().getAttribute("aria-expanded")).toBe("true");
  expect(code()).toBe('{  "url": "https://example.com"}');

  const buttons = [
    ...container.querySelectorAll<HTMLButtonElement>(
      '[data-slot="tool-approval"] button'
    ),
  ];
  expect(buttons.map((button) => button.textContent)).toEqual([
    "Decline",
    "Approve",
  ]);
  await act(() => buttons[1]?.click());
  expect(onApprovalResponse).toHaveBeenLastCalledWith({
    approved: true,
    id: "run-1::call-1",
  });
  await act(() => buttons[0]?.click());
  expect(onApprovalResponse).toHaveBeenLastCalledWith({
    approved: false,
    id: "run-1::call-1",
  });

  await render({
    approval: { approved: true, id: "run-1::call-1" },
    input,
    state: "approval-responded",
    type: "dynamic-tool",
    ...base,
  });
  expect(
    container
      .querySelector('[data-slot="tool-part"]')
      ?.getAttribute("data-status")
  ).toBe("running");
  expect(container.querySelector('[data-slot="tool-approval"]')).toBeNull();
});

it("renders a pending approval read-only without a handler", async () => {
  await render({
    approval: { id: "run-1::call-1" },
    input,
    state: "approval-requested",
    type: "dynamic-tool",
    ...base,
  });
  expect(container.querySelector('[data-slot="tool-approval"]')).toBeNull();
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
});
