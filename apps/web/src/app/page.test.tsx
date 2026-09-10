import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NewProjectForm } from "@/components/new-project/new-project-form";
import { TooltipProvider } from "@/components/ui/tooltip";
import HomePage from "./page";

let container: HTMLDivElement;
let root: Root;

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

it("keeps extracted form instances independent and preserves caller classes", async () => {
  await act(() =>
    root.render(
      <TooltipProvider>
        <NewProjectForm className="max-w-sm" />
        <NewProjectForm className="max-w-md" />
      </TooltipProvider>
    )
  );

  const formContainers = container.children;
  expect(formContainers.item(0)?.classList.contains("max-w-sm")).toBe(true);
  expect(formContainers.item(1)?.classList.contains("max-w-md")).toBe(true);
  const ids = Array.from(
    container.querySelectorAll("[id]"),
    (element) => element.id
  );
  expect(new Set(ids).size).toBe(ids.length);
  expect(
    Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="text"]'),
      (input) => input.labels?.length
    )
  ).toEqual(Array.from({ length: 10 }, () => 1));

  await act(() =>
    container
      .querySelectorAll<HTMLButtonElement>('button[type="submit"]')
      .item(1)
      .click()
  );
  expect(
    Array.from(
      container.querySelectorAll("h1"),
      (heading) => heading.textContent
    )
  ).toEqual(["New Project", "Congratulations!"]);
  expect(container.querySelectorAll("form")).toHaveLength(1);
});

it("disables fixed settings and shows a linked site preview after Deploy", async () => {
  await act(() =>
    root.render(
      <TooltipProvider>
        <HomePage />
      </TooltipProvider>
    )
  );

  const inputs =
    container.querySelectorAll<HTMLInputElement>('input[type="text"]');
  expect(
    Array.from(inputs, (input) => ({
      disabled: input.disabled,
      name: input.name,
      value: input.value,
    }))
  ).toEqual([
    { disabled: true, name: "applicationPreset", value: "Vite" },
    { disabled: true, name: "rootDirectory", value: "./" },
    { disabled: true, name: "buildCommand", value: "npm run build" },
    { disabled: true, name: "outputDirectory", value: "dist" },
    { disabled: true, name: "installCommand", value: "npm ci --include=dev" },
  ]);
  expect(container.querySelector('[role="switch"]')).toBeNull();

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
  expect(
    Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="text"]'),
      (input) => input.value
    )
  ).toEqual(["Vite", "./", "npm run build", "dist", "npm ci --include=dev"]);

  await act(() =>
    container.querySelector<HTMLButtonElement>('button[type="submit"]')?.click()
  );
  const heading = container.querySelector("h1");
  expect(heading?.textContent).toBe("Congratulations!");
  expect(document.activeElement).toBe(heading);
  expect(container.querySelector("form")).toBeNull();
  const previewLink = container.querySelector('a[href="https://vercel.com"]');
  expect(previewLink?.getAttribute("target")).toBe("_blank");
  expect(previewLink?.getAttribute("rel")).toBe("noopener noreferrer");
  expect(previewLink?.querySelector("img")?.getAttribute("alt")).toBe(
    "vercel.com website preview"
  );
});
