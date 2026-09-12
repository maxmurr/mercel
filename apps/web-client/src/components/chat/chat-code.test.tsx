import type { HighlightOptions, HighlightResult } from "@streamdown/code";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatCode } from "@/components/chat/chat-code";
import { TooltipProvider } from "@/components/ui/tooltip";

const { highlightMock } = vi.hoisted(() => ({
  highlightMock: vi.fn(
    (options: HighlightOptions): HighlightResult => ({
      tokens: options.code.split("\n").map((line) => [
        {
          content: line,
          htmlStyle: { "--shiki-dark": "#eeeeee", color: "#111111" },
          offset: 0,
        },
      ]),
    })
  ),
}));

vi.mock("@streamdown/code", () => ({
  code: {
    getThemes: () => ["github-light", "github-dark"],
    highlight: highlightMock,
  },
}));

const directories: Record<string, { name: string; type: string }[]> = {
  ".": [
    { name: "index.html", type: "file" },
    { name: "src", type: "directory" },
    { name: "node_modules", type: "directory" },
    { name: "vite.config.js", type: "file" },
    { name: "broken", type: "directory" },
    { name: "notes.txt", type: "file" },
    { name: "missing.txt", type: "file" },
  ],
  src: [
    { name: "main.jsx", type: "file" },
    { name: "App.jsx", type: "file" },
  ],
};
const files: Record<string, string> = {
  "notes.txt": "plain notes",
  "src/main.jsx": 'import React from "react";\n\nexport default App;\n',
};

function workspaceResponse(url: string) {
  const { pathname, searchParams } = new URL(url, "http://localhost");
  const path = searchParams.get("path") ?? "";
  const notFound = Response.json(
    { error: `Path "${path}" not found` },
    { status: 404 }
  );
  if (pathname.endsWith("/fs/list")) {
    const entries = directories[path];
    return entries ? Response.json({ entries, path }) : notFound;
  }
  const content = files[path];
  return content === undefined
    ? notFound
    : Response.json({ content, path, type: "file" });
}

const fetchMock = vi.fn<typeof fetch>((input) =>
  Promise.resolve(workspaceResponse(String(input)))
);
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
  fetchMock.mockClear();
  highlightMock.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

// Let fetch, the query cache, and React's batched notifications settle.
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

async function renderChatCode() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ChatCode />
        </TooltipProvider>
      </QueryClientProvider>
    )
  );
  await settle();
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
    throw new Error(`Button not found: ${label}`);
  }
  await act(() => button.click());
  await settle();
}

function treeLabels() {
  return Array.from(
    container.querySelectorAll("nav button"),
    (button) => button.textContent
  );
}

function codeLines() {
  return Array.from(
    container.querySelectorAll("code > span"),
    (line) => line.textContent
  );
}

it("lists folders first, hides node_modules, and expands folders on demand", async () => {
  await renderChatCode();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/mastra/workspaces/sandbox/fs/list?path=."
  );
  expect(treeLabels()).toEqual([
    "broken",
    "src",
    "index.html",
    "missing.txt",
    "notes.txt",
    "vite.config.js",
  ]);
  expect(container.querySelector("h2")?.textContent).toBe("Files");
  expect(container.textContent).toContain("No file selected");
  expect(container.textContent).not.toContain("No console output.");
  await clickButton("Console");
  expect(container.textContent).toContain("No console output.");

  await clickButton("src");
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/mastra/workspaces/sandbox/fs/list?path=src"
  );
  expect(
    container.querySelector('nav [aria-expanded="true"]')?.textContent
  ).toBe("src");
  expect(treeLabels()).toEqual([
    "broken",
    "src",
    "App.jsx",
    "main.jsx",
    "index.html",
    "missing.txt",
    "notes.txt",
    "vite.config.js",
  ]);

  await clickButton("src");
  expect(container.querySelector('nav [aria-expanded="true"]')).toBeNull();
  expect(treeLabels()).not.toContain("main.jsx");
});

it("shows the selected file with a breadcrumb, line numbers, and themed tokens", async () => {
  await renderChatCode();
  await clickButton("src");
  await clickButton("main.jsx");

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/mastra/workspaces/sandbox/fs/read?path=src%2Fmain.jsx"
  );
  expect(container.querySelector('[aria-current="true"]')?.textContent).toBe(
    "main.jsx"
  );
  expect(
    container.querySelector('[aria-label="breadcrumb"]')?.textContent
  ).toBe("srcmain.jsx");
  expect(highlightMock).toHaveBeenCalledWith(
    {
      code: 'import React from "react";\n\nexport default App;',
      language: "jsx",
      themes: ["github-light", "github-dark"],
    },
    expect.any(Function)
  );
  expect(codeLines()).toEqual([
    'import React from "react";',
    "",
    "export default App;",
  ]);
  const token = container.querySelector<HTMLElement>("code > span > span");
  expect(token?.getAttribute("style")).toContain("--shiki-light: #111111");
  expect(token?.getAttribute("style")).toContain("--shiki-dark: #eeeeee");
  expect(token?.style.color).toBe("");
  expect(token?.className).toBe(
    "text-(--shiki-light) dark:text-(--shiki-dark)"
  );
  const showFiles = container.querySelector('[aria-label="Show files"]');
  expect(showFiles?.getAttribute("aria-controls")).toBe("workspace-file-tree");
  expect(container.querySelector("nav")?.id).toBe("workspace-file-tree");
});

it("renders unknown file types as plain text without highlighting", async () => {
  await renderChatCode();
  await clickButton("notes.txt");

  expect(highlightMock).not.toHaveBeenCalled();
  expect(codeLines()).toEqual(["plain notes"]);
});

it("reports folder and file errors in place", async () => {
  await renderChatCode();
  await clickButton("broken");
  expect(container.querySelector('nav [role="alert"]')?.textContent).toBe(
    'Path "broken" not found'
  );

  await clickButton("missing.txt");
  expect(container.querySelector('section [role="alert"]')?.textContent).toBe(
    'Path "missing.txt" not found'
  );
  expect(container.querySelector("code")).toBeNull();
});

it("shows skeleton rows in the tree while the workspace root loads", async () => {
  fetchMock.mockImplementationOnce(
    () => new Promise<Response>(() => undefined)
  );
  await renderChatCode();

  const status = container.querySelector('nav [role="status"]');
  expect(status?.textContent).toBe("Loading…");
  expect(status?.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(10);
  expect(container.querySelector("h2")?.textContent).toBe("Files");
  expect(container.textContent).not.toContain("No file selected");
});

it("shows skeleton lines while a file loads", async () => {
  await renderChatCode();
  fetchMock.mockImplementationOnce(
    () => new Promise<Response>(() => undefined)
  );
  await clickButton("notes.txt");

  const status = container.querySelector('section [role="status"]');
  expect(status?.textContent).toBe("Loading…");
  expect(status?.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(6);
  expect(container.querySelector("code")).toBeNull();
});

it("shows an empty state when the sandbox has no visible files", async () => {
  fetchMock.mockImplementationOnce(() =>
    Promise.resolve(
      Response.json({
        entries: [{ name: "node_modules", type: "directory" }],
        path: ".",
      })
    )
  );
  await renderChatCode();

  expect(container.textContent).toContain("No files yet");
  expect(container.querySelector("nav")).toBeNull();
  expect(container.textContent).not.toContain("No file selected");
});

it("shows an empty state when there is no sandbox", async () => {
  fetchMock.mockImplementationOnce(() =>
    Promise.resolve(
      Response.json({ error: 'Path "." not found' }, { status: 404 })
    )
  );
  await renderChatCode();

  expect(container.textContent).toContain("No sandbox yet");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector("nav")).toBeNull();
});
