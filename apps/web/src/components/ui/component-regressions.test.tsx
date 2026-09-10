import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Calendar } from "./calendar";
import { ChartStyle } from "./chart";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupTextarea,
} from "./input-group";
import {
  SidebarMenuSkeleton,
  SidebarProvider,
  SidebarTrigger,
} from "./sidebar";
import { Slider } from "./slider";
import { Tabs, TabsList, TabsTrigger } from "./tabs";
import { toast } from "./toast";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

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

it("moves calendar focus to the next day with ArrowRight", async () => {
  const selected = new Date(2026, 0, 15);
  await act(() => {
    root.render(
      <Calendar defaultMonth={selected} mode="single" selected={selected} />
    );
  });
  const day = container.querySelector<HTMLButtonElement>(
    `button[data-day="${selected.toLocaleDateString()}"]`
  );
  expect(day).not.toBeNull();
  await act(() => day?.focus());
  expect(document.activeElement).toBe(day);
  await act(() => {
    day?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" })
    );
  });
  expect(document.activeElement?.getAttribute("data-day")).toBe(
    new Date(2026, 0, 16).toLocaleDateString()
  );
  const focusedDay = document.activeElement;
  await act(() => {
    root.render(
      <Calendar defaultMonth={selected} mode="single" selected={selected} />
    );
  });
  expect(document.activeElement).toBe(focusedDay);
});

it.each([
  {
    component: (
      <Tabs defaultValue="first" orientation="vertical">
        <TabsList aria-label="Sections">
          <TabsTrigger value="first">First</TabsTrigger>
          <TabsTrigger value="second">Second</TabsTrigger>
        </TabsList>
      </Tabs>
    ),
    name: "Tabs",
  },
  {
    component: (
      <ToggleGroup aria-label="Options" orientation="vertical">
        <ToggleGroupItem value="first">First</ToggleGroupItem>
        <ToggleGroupItem value="second">Second</ToggleGroupItem>
      </ToggleGroup>
    ),
    name: "ToggleGroup",
  },
])("moves vertical $name focus with ArrowDown", async ({ component }) => {
  await act(() => root.render(component));
  const [first, second] = container.querySelectorAll("button");
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  await act(() => first?.focus());
  expect(document.activeElement).toBe(first);
  await act(() => {
    first?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" })
    );
  });
  expect(document.activeElement).toBe(second);
});

it.each([
  { props: {}, values: ["0"] },
  { props: { min: 10 }, values: ["10"] },
  { props: { value: 50 }, values: ["50"] },
  { props: { defaultValue: 50 }, values: ["50"] },
  { props: { defaultValue: [20, 80], value: 0 }, values: ["0"] },
  { props: { value: [20, 80] }, values: ["20", "80"] },
  { props: { defaultValue: [20, 80] }, values: ["20", "80"] },
  { props: { value: [50, 50] }, values: ["50", "50"] },
])("renders slider thumbs matching $props", ({ props, values }) => {
  const html = renderToString(<Slider {...props} />);
  const document = new DOMParser().parseFromString(html, "text/html");
  expect(document.querySelectorAll('[data-slot="slider-thumb"]')).toHaveLength(
    values.length
  );
  expect(
    Array.from(document.querySelectorAll('input[type="range"]'), (input) =>
      input.getAttribute("value")
    )
  ).toEqual(values);
});

it("renders the same sidebar skeleton across server and client random seeds", () => {
  const random = vi.spyOn(Math, "random").mockReturnValue(0);
  const server = renderToString(<SidebarMenuSkeleton showIcon />);
  random.mockReturnValue(0.99);
  const client = renderToString(<SidebarMenuSkeleton showIcon />);
  expect(client).toBe(server);
});

it("renders chart theme CSS without allowing HTML injection", () => {
  const html = renderToString(
    <ChartStyle
      config={{
        revenue: { theme: { dark: "blue", light: "red" } },
        unsafe: { color: "</style><script>alert(1)</script>" },
      }}
      id="chart-test"
    />
  );
  const parsed = new DOMParser().parseFromString(html, "text/html");
  expect(parsed.querySelectorAll("style")).toHaveLength(1);
  expect(parsed.querySelector("script")).toBeNull();
  expect(parsed.querySelector("style")?.textContent).toContain(
    "--color-revenue: red;"
  );
  expect(parsed.querySelector("style")?.textContent).toContain(
    "--color-revenue: blue;"
  );
});

it.each(["input", "textarea"])(
  "focuses input-group %s from its addon without hijacking buttons",
  async (control) => {
    await act(() =>
      root.render(
        <InputGroup>
          {control === "input" ? (
            <InputGroupInput aria-label="Value" />
          ) : (
            <InputGroupTextarea aria-label="Value" />
          )}
          <InputGroupAddon>
            <span>Focus control</span>
            <InputGroupButton>Action</InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      )
    );
    await act(() => container.querySelector("span")?.click());
    expect(document.activeElement).toBe(container.querySelector(control));
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    await act(() => {
      button?.focus();
      button?.click();
    });
    expect(document.activeElement).toBe(button);
  }
);

it.each([false, true])(
  "persists sidebar state or reports blocked cookie writes: %s",
  async (blocked) => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    );
    const setCookie = blocked
      ? vi.fn().mockRejectedValue(new Error("Cookie write blocked"))
      : vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("cookieStore", { set: setCookie });
    const notify = vi.spyOn(toast, "add").mockReturnValue("preference-error");
    await act(() =>
      root.render(
        <SidebarProvider>
          <SidebarTrigger />
        </SidebarProvider>
      )
    );
    await act(() => container.querySelector("button")?.click());
    expect(setCookie).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "sidebar_state",
        path: "/",
        value: "false",
      })
    );
    expect(notify).toHaveBeenCalledTimes(blocked ? 1 : 0);
  }
);
