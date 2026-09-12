import { readFile } from "node:fs/promises";
import { instant } from "@next/playwright";
import { expect, test } from "@playwright/test";
import { z } from "zod";

const accountMenuName = /^Account menu for /;
let threadPath = "";

const routes = [
  { name: "chat", shellId: "chat-shell" },
  { name: "thread", shellId: "chat-thread-shell" },
] as const;

test.beforeAll(async ({ request }) => {
  const build = z
    .object({
      config: z.object({
        experimental: z.object({
          exposeTestingApiInProductionBuild: z.literal(true),
        }),
      }),
    })
    .safeParse(
      JSON.parse(
        await readFile(".next-instant/required-server-files.json", "utf8")
      )
    );
  if (!build.success) {
    throw new Error(
      "Instant navigation testing API missing: run bun run build:e2e before testing."
    );
  }
  const response = await request.get("/api/chat/threads");
  if (!response.ok()) {
    throw new Error(
      `Instant navigation thread list failed (${response.status()}): check login state and database.`
    );
  }
  const { threads } = z
    .object({
      threads: z.array(z.object({ id: z.uuid() })),
    })
    .parse(await response.json());
  const [thread] = threads;
  if (!thread) {
    throw new Error(
      "Instant navigation needs an account with at least one conversation."
    );
  }
  threadPath = `/chat/${thread.id}`;
});

for (const route of routes) {
  test(`${route.name} shell on initial load`, async ({
    page,
    baseURL,
  }, testInfo) => {
    if (!baseURL) {
      throw new Error("Instant navigation baseURL is missing.");
    }
    const path = route.name === "chat" ? "/chat" : threadPath;
    const shell = page.getByTestId(route.shellId);
    const account = shell.getByRole("button", { name: accountMenuName });

    await instant(
      page,
      async () => {
        await page.goto(path);
        await expect(page).toHaveURL(path);
        await expect(shell).toBeVisible();
        await expect(
          shell.getByRole("button", { exact: true, name: "Toggle Chats" })
        ).toBeVisible();
        if (route.name === "chat") {
          await expect(
            shell.getByRole("heading", {
              exact: true,
              name: "What do you want to create?",
            })
          ).toBeVisible();
          await expect(
            shell.getByRole("textbox", {
              exact: true,
              name: "Describe what you want to create",
            })
          ).toBeVisible();
        } else {
          await expect(
            shell
              .getByRole("status")
              .filter({ hasText: "Loading conversation…" })
          ).toBeVisible();
          await expect(
            shell.getByRole("textbox", { exact: true, name: "Message" })
          ).toHaveCount(0);
        }
        await expect(account).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath("shell.png") });
      },
      { baseURL }
    );

    // Locked documents contain only the shell; reload to verify the real UI.
    await page.reload();
    await expect(account).toBeVisible();
    if (route.name === "thread") {
      await expect(
        shell.getByRole("textbox", { exact: true, name: "Message" })
      ).toBeVisible();
      await expect(
        shell.getByRole("status").filter({ hasText: "Loading conversation…" })
      ).toHaveCount(0);
    }
    await page.screenshot({ path: testInfo.outputPath("loaded.png") });
  });

  test(`${route.name} shell on client navigation`, async ({
    page,
  }, testInfo) => {
    const path = route.name === "chat" ? "/chat" : threadPath;
    const source = route.name === "chat" ? threadPath : "/chat";
    await page.goto(source);
    await expect(
      page.getByRole("button", { name: accountMenuName })
    ).toBeVisible();
    if (route.name === "chat" || testInfo.project.name === "mobile") {
      await page
        .getByRole("button", { exact: true, name: "Toggle Chats" })
        .click();
    }
    const trigger = page.locator(`a[href="${path}"]`).filter({ visible: true });
    await expect(trigger).toBeVisible();
    const shell = page.getByTestId(route.shellId);
    const account = shell.getByRole("button", { name: accountMenuName });

    await instant(page, async () => {
      await trigger.click();
      await expect(page).toHaveURL(path);
      await expect(shell).toBeVisible();
      await expect(
        shell.getByRole("button", { exact: true, name: "Toggle Chats" })
      ).toBeVisible();
      if (route.name === "chat") {
        await expect(
          shell.getByRole("heading", {
            exact: true,
            name: "What do you want to create?",
          })
        ).toBeVisible();
        await expect(
          shell.getByRole("textbox", {
            exact: true,
            name: "Describe what you want to create",
          })
        ).toBeVisible();
      } else {
        await expect(
          shell.getByRole("status").filter({ hasText: "Loading conversation…" })
        ).toBeVisible();
        await expect(
          shell.getByRole("textbox", { exact: true, name: "Message" })
        ).toHaveCount(0);
      }
      await expect(account).toHaveCount(0);
      if (route.name === "chat") {
        await shell
          .getByRole("textbox", {
            exact: true,
            name: "Describe what you want to create",
          })
          .fill("Keep this unsent draft");
      }
      await page.screenshot({ path: testInfo.outputPath("shell.png") });
    });

    await expect(account).toBeVisible();
    if (route.name === "chat") {
      const prompt = shell.getByRole("textbox", {
        exact: true,
        name: "Describe what you want to create",
      });
      await expect(prompt).toHaveValue("Keep this unsent draft");
      await expect(prompt).toBeFocused();
    } else {
      await expect(
        shell.getByRole("textbox", { exact: true, name: "Message" })
      ).toBeVisible();
      await expect(
        shell.getByRole("status").filter({ hasText: "Loading conversation…" })
      ).toHaveCount(0);
    }
    await page.screenshot({ path: testInfo.outputPath("loaded.png") });
  });
}
