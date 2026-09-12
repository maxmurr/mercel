import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { authClient } from "@/features/user/user-client";
import { UserMenuActions } from "./user-menu-actions";

const push = vi.fn();
let sessionPending = true;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/features/user/user-client", () => ({
  authClient: {
    signOut: vi.fn(),
    useSession: () => ({ data: null, isPending: sessionPending }),
  },
}));

const signOut = vi.mocked(authClient.signOut);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  sessionPending = true;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  signOut.mockResolvedValue({ data: { success: true }, error: null });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderMenu(
  user: ComponentProps<typeof UserMenuActions>["user"]
) {
  await act(() => root.render(<UserMenuActions user={user} />));
}

async function openMenu() {
  const trigger = container.querySelector("button");
  if (!trigger) {
    throw new Error("Account menu trigger not found");
  }
  await act(() => trigger.click());
}

function menuItemWithText(text: string): HTMLElement {
  const item = Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitem"]')
  ).find((entry) => entry.textContent === text);
  if (!item) {
    throw new Error(`Account menu item not found: ${text}`);
  }
  return item;
}

it("shows the account monogram and details, then signs out", async () => {
  await renderMenu({ email: "ada@example.com", name: "Ada Lovelace" });
  expect(container.textContent).toContain("AL");

  await openMenu();
  const menu = document.querySelector('[role="menu"]');
  expect(menu?.textContent).toContain("Ada Lovelace");
  expect(menu?.textContent).toContain("ada@example.com");

  await act(() => menuItemWithText("Sign Out").click());
  expect(signOut).toHaveBeenCalledOnce();
  expect(push).toHaveBeenCalledWith("/sign-in");
});

it("opens the theme choices above sign out", async () => {
  await renderMenu({ email: "ada@example.com", name: "Ada Lovelace" });
  await openMenu();
  await act(() => menuItemWithText("Theme").click());

  const themeLabels = Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')
  ).map((option) => option.textContent);
  expect(themeLabels).toEqual(["Light", "Dark", "System"]);
});

it("falls back to the email when the account has no name", async () => {
  await renderMenu({ email: "grace@example.com", name: " " });
  expect(container.textContent).toContain("G");

  await openMenu();
  expect(document.querySelector('[role="menu"]')?.textContent).toContain(
    "grace@example.com"
  );
});

it("drops the server snapshot once the client observes a signed-out session", async () => {
  sessionPending = false;
  await renderMenu({ email: "ada@example.com", name: "Ada Lovelace" });
  expect(container.querySelector("button")).toBeNull();
});

it("renders nothing while signed out", async () => {
  await renderMenu(null);
  expect(container.querySelector("button")).toBeNull();
});
