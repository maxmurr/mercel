import { ThemeProvider } from "next-themes";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ThemeSwitcher } from "./theme-switcher";

let container: HTMLDivElement;
let root: Root;
let prefersDark: boolean;
const mediaListeners = new Set<(event: { matches: boolean }) => void>();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  prefersDark = false;
  localStorage.clear();
  document.documentElement.className = "font-sans";
  vi.stubGlobal("matchMedia", (query: string) => ({
    addEventListener: vi.fn(),
    addListener: (listener: (event: { matches: boolean }) => void) => {
      mediaListeners.add(listener);
    },
    matches: query === "(prefers-color-scheme: dark)" && prefersDark,
    media: query,
    removeEventListener: vi.fn(),
    removeListener: (listener: (event: { matches: boolean }) => void) => {
      mediaListeners.delete(listener);
    },
  }));
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  localStorage.clear();
  mediaListeners.clear();
  document.documentElement.className = "";
  document.documentElement.style.removeProperty("color-scheme");
  Reflect.deleteProperty(Element.prototype, "getAnimations");
  vi.unstubAllGlobals();
});

async function renderSwitcher() {
  await act(() =>
    root.render(
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <ThemeSwitcher />
      </ThemeProvider>
    )
  );
}

async function openThemeMenu() {
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Change theme"]'
  );
  if (!trigger) {
    throw new Error("Theme switcher trigger not found");
  }
  if (trigger.getAttribute("aria-expanded") !== "true") {
    await act(() => trigger.click());
  }
}

async function chooseTheme(label: string) {
  await openThemeMenu();
  const option = Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')
  ).find((item) => item.textContent === label);
  if (!option) {
    throw new Error(`Theme switcher option not found: ${label}`);
  }
  await act(() => option.click());
}

async function changeSystemTheme(matches: boolean) {
  prefersDark = matches;
  await act(() => {
    for (const listener of mediaListeners) {
      listener({ matches });
    }
  });
}

it.each([
  { label: "Dark", resolved: "dark", value: "dark" },
  { label: "Light", resolved: "light", value: "light" },
  { label: "System", resolved: "light", value: "system" },
])(
  "switches to $label and restores the saved preference",
  async ({ label, resolved, value }) => {
    await renderSwitcher();
    expect(document.documentElement.classList.contains("light")).toBe(true);
    await openThemeMenu();
    expect(document.querySelector('[aria-checked="true"]')?.textContent).toBe(
      "System"
    );

    await chooseTheme(label);
    expect(localStorage.getItem("theme")).toBe(value);
    expect(document.documentElement.className).toBe(`font-sans ${resolved}`);
    expect(document.documentElement.style.colorScheme).toBe(resolved);
    await openThemeMenu();
    expect(document.querySelector('[aria-checked="true"]')?.textContent).toBe(
      label
    );

    await act(() => root.render(null));
    document.documentElement.classList.remove("light", "dark");
    await renderSwitcher();
    expect(document.documentElement.classList.contains(resolved)).toBe(true);
    await openThemeMenu();
    expect(document.querySelector('[aria-checked="true"]')?.textContent).toBe(
      label
    );
  }
);

it("follows system changes only in system mode and syncs preferences across tabs", async () => {
  prefersDark = true;
  await renderSwitcher();
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  await changeSystemTheme(false);
  expect(document.documentElement.classList.contains("light")).toBe(true);
  await chooseTheme("Light");
  await changeSystemTheme(true);
  expect(document.documentElement.classList.contains("light")).toBe(true);
  await chooseTheme("System");
  expect(document.documentElement.classList.contains("dark")).toBe(true);

  await act(() => {
    window.dispatchEvent(
      new StorageEvent("storage", { key: "theme", newValue: "light" })
    );
  });
  expect(document.documentElement.classList.contains("light")).toBe(true);
  await openThemeMenu();
  expect(document.querySelector('[aria-checked="true"]')?.textContent).toBe(
    "Light"
  );
});
