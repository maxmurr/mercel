import type { DynamicToolUIPart } from "ai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuestionnairePart } from "@/components/ai-elements/questionnaire-part";
import { isHiddenToolPart } from "@/components/ai-elements/tool";

const input = {
  questions: [
    {
      id: "priority",
      label: "Priority",
      options: [
        { description: "Ship this quarter.", label: "Speed" },
        { label: "Cost" },
      ],
      question: "What matters most?",
      type: "single_select",
    },
    {
      id: "pricing",
      label: "Pricing models",
      options: [{ label: "Usage-based" }, { label: "Per seat" }],
      question: "Which pricing models?",
      type: "multi_select",
    },
    {
      id: "constraints",
      label: "Constraints",
      placeholder: "EU data residency…",
      question: "Any hard constraints?",
      required: false,
      type: "text",
    },
  ],
  submitLabel: "Start research",
};
const pending: DynamicToolUIPart = {
  approval: { id: "run-1::call-1" },
  input,
  state: "approval-requested",
  toolCallId: "call-1",
  toolName: "ask_user",
  type: "dynamic-tool",
};
const onApprovalResponse = vi.fn();
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onApprovalResponse.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(part = pending) {
  await act(() =>
    root.render(
      <QuestionnairePart onApprovalResponse={onApprovalResponse} part={part} />
    )
  );
}

async function click(selector: string) {
  const element = container.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Questionnaire test element missing: ${selector}`);
  }
  await act(() => element.click());
}

it("validates steps, keeps previous answers, supports multi-select and skips optional text", async () => {
  await render();
  expect(isHiddenToolPart(pending)).toBe(false);
  expect(container.querySelector('[data-slot="tool-part"]')).toBeNull();
  expect(container.querySelector('[role="progressbar"]')?.textContent).toBe(
    "Question 1 of 3"
  );
  expect(container.querySelectorAll("fieldset:not([hidden])")).toHaveLength(1);
  await click('[data-slot="questionnaire-next"]');
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Choose an answer to continue."
  );
  expect(onApprovalResponse).not.toHaveBeenCalled();

  await click('input[value="Cost"]');
  await click('[data-slot="questionnaire-next"]');
  expect(document.activeElement).toBe(
    container.querySelector("fieldset:not([hidden])")
  );
  expect(document.activeElement?.textContent).toContain(
    "Which pricing models?"
  );
  await click('input[value="Usage-based"]');
  await click('input[value="Per seat"]');
  await click('[data-slot="questionnaire-previous"]');
  expect(
    container.querySelector<HTMLInputElement>('input[value="Cost"]')?.checked
  ).toBe(true);
  await click('[data-slot="questionnaire-next"]');
  expect(
    container.querySelectorAll('input[type="checkbox"]:checked')
  ).toHaveLength(2);
  await click('[data-slot="questionnaire-next"]');
  expect(container.querySelector('[role="progressbar"]')?.textContent).toBe(
    "Question 3 of 3"
  );
  await click('[data-slot="questionnaire-skip"]');
  expect(onApprovalResponse).toHaveBeenCalledOnce();
  const [response] = onApprovalResponse.mock.calls[0] ?? [];
  expect(response).toMatchObject({ approved: true, id: "run-1::call-1" });
  expect(JSON.parse(response.reason)).toEqual({
    answers: {
      constraints: null,
      pricing: ["Usage-based", "Per seat"],
      priority: "Cost",
    },
  });
});

it.each([
  {
    input: {
      questions: Array.from({ length: 9 }, (_, index) => ({
        id: `question-${index}`,
        label: "Question",
        question: "Choose?",
        type: "text",
      })),
    },
    output: {
      error: true,
      message: "Tool input validation failed for ask_user.",
    },
    state: "output-available",
  },
  { input, output: { error: true }, state: "output-available" },
  { errorText: "Tool failed", input, state: "output-error" },
  {
    approval: { approved: false, id: "approval-1" },
    input,
    state: "output-denied",
  },
] as const)(
  "hides raw ask_user diagnostics without leaving a visible chat part: $state",
  async (result) => {
    const part: DynamicToolUIPart = {
      ...result,
      toolCallId: "failed-call",
      toolName: "ask_user",
      type: "dynamic-tool",
    };
    expect(isHiddenToolPart(part)).toBe(true);
    await render(part);
    expect(container.childElementCount).toBe(0);
  }
);

it("handles numbered shortcuts only inside the questionnaire", async () => {
  await render();
  const fieldset = container.querySelector("fieldset");
  await act(() =>
    fieldset?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "2" })
    )
  );
  expect(
    container.querySelector<HTMLInputElement>('input[value="Cost"]')?.checked
  ).toBe(true);
  await act(() =>
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "1" })
    )
  );
  expect(
    container.querySelector<HTMLInputElement>('input[value="Cost"]')?.checked
  ).toBe(true);
});

it("renders saved output as a compact, read-only answer summary after remount", async () => {
  const output: DynamicToolUIPart = {
    ...pending,
    approval: { approved: true, id: "run-1::call-1" },
    output: {
      answers: {
        constraints: null,
        pricing: ["Usage-based", "Per seat"],
        priority: "Cost",
      },
    },
    state: "output-available",
  };
  await render(output);
  expect(container.textContent).toContain("Answers sent");
  expect(
    [...container.querySelectorAll("dd")].map((element) => element.textContent)
  ).toEqual(["Cost", "Usage-based, Per seat", "No preference"]);
  expect(container.querySelector("form")).toBeNull();
  await act(() => root.unmount());
  root = createRoot(container);
  await render(output);
  expect(container.textContent).toContain("Answers sent");
  expect(onApprovalResponse).not.toHaveBeenCalled();
});

it("does not claim answers were sent while the resume request is still pending", async () => {
  await render({
    ...pending,
    approval: { approved: true, id: "run-1::call-1", reason: "{}" },
    state: "approval-responded",
  });
  expect(container.textContent).toContain("Sending answers…");
  expect(container.textContent).not.toContain("Answers sent");
});

it("submits trimmed free text and preserves it for retry after a failed handoff", async () => {
  onApprovalResponse.mockRejectedValueOnce(new Error("Disconnected"));
  await render({
    ...pending,
    input: {
      questions: [
        {
          id: "notes",
          label: "Notes",
          question: "What should we know?",
          type: "text",
        },
      ],
    },
  });
  await click('[data-slot="questionnaire-submit"]');
  expect(onApprovalResponse).not.toHaveBeenCalled();
  const control = container.querySelector<HTMLInputElement>(
    '[data-slot="questionnaire-input"]'
  );
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set?.call(control, "  EU only  ");
    control?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click('[data-slot="questionnaire-submit"]');
  expect(container.textContent).toContain("Could not send answers.");
  expect(control?.value).toBe("  EU only  ");
  await click('[data-slot="questionnaire-submit"]');
  expect(onApprovalResponse).toHaveBeenCalledTimes(2);
  const [response] = onApprovalResponse.mock.lastCall ?? [];
  expect(JSON.parse(response.reason)).toEqual({
    answers: { notes: "EU only" },
  });
});
