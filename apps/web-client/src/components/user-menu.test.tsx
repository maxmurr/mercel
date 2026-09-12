import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { authClient } from "@/lib/auth-client";
import { UserMenu } from "./user-menu";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { signOut: vi.fn(), useSession: vi.fn() },
}));

const useSession = vi.mocked(authClient.useSession);
const signOut = vi.mocked(authClient.signOut);

type Session = ReturnType<typeof authClient.useSession>;

let container: HTMLDivElement;
let root: Root;

function sessionFor(user: { email: string; image?: string; name: string }) {
  return { data: { user }, isPending: false } as unknown as Session;
}

beforeEach(() => {
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

async function renderMenu(session: Session) {
  useSession.mockReturnValue(session);
  await act(() => root.render(<UserMenu />));
}

async function openMenu() {
  const trigger = container.querySelector("button");
  if (!trigger) {
    throw new Error("Account menu trigger not found");
  }
  await act(() => trigger.click());
}

it("shows the account monogram and details, then signs out", async () => {
  await renderMenu(
    sessionFor({ email: "ada@example.com", name: "Ada Lovelace" })
  );
  expect(container.textContent).toContain("AL");

  await openMenu();
  const menu = document.querySelector('[role="menu"]');
  expect(menu?.textContent).toContain("Ada Lovelace");
  expect(menu?.textContent).toContain("ada@example.com");

  const signOutItem = document.querySelector<HTMLElement>('[role="menuitem"]');
  await act(() => signOutItem?.click());
  expect(signOut).toHaveBeenCalledOnce();
  expect(push).toHaveBeenCalledWith("/sign-in");
});

it("falls back to the email when the account has no name", async () => {
  await renderMenu(sessionFor({ email: "grace@example.com", name: " " }));
  expect(container.textContent).toContain("G");

  await openMenu();
  expect(document.querySelector('[role="menu"]')?.textContent).toContain(
    "grace@example.com"
  );
});

it("renders nothing while signed out", async () => {
  await renderMenu({ data: null, isPending: false } as unknown as Session);
  expect(container.querySelector("button")).toBeNull();
});
