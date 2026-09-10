import { Elysia } from "elysia";
import { initLogger } from "evlog";
import { evlog } from "evlog/elysia";
import { expect, test, vi } from "vitest";
import type { IUploadService } from "../services/upload.service.interface.ts";
import { MockUploadService } from "../services/upload.service.mock.ts";
import { createDeployRoutes } from "./deploy.routes.ts";

initLogger({ enabled: false });

const ID_PATTERN = /^[0-9A-Za-z]{5}$/;

const post = (
  app: { handle: (request: Request) => Promise<Response> },
  body: unknown
) =>
  app.handle(
    new Request("http://localhost/deploy", {
      body: body === undefined ? null : JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );

test.each([
  undefined,
  null,
  [],
  {},
  "repo",
  { repoUrl: "" },
  { repoUrl: null },
  { repoUrl: 42 },
])("rejects invalid input %j before invoking the service", async (body) => {
  const uploadRepository = vi.fn<IUploadService["uploadRepository"]>();
  const app = createDeployRoutes({ uploadRepository });

  const response = await post(app, body);

  expect(response.status).toBe(422);
  expect(uploadRepository).not.toHaveBeenCalled();
});

test("mounted routes return the generated ID after the service resolves", async () => {
  const uploadService = new MockUploadService();
  const app = new Elysia().use(evlog()).use(createDeployRoutes(uploadService));

  const response = await post(app, { repoUrl: "/tmp/local repository" });

  expect(response.status).toBe(200);
  const id = uploadService.calls[0]?.id;
  expect(id).toMatch(ID_PATTERN);
  expect(await response.json()).toEqual({ id });
  expect(uploadService.calls).toEqual([
    { id, repoUrl: "/tmp/local repository" },
  ]);
});

test.each([new Error("Test upload failure"), "Test string rejection"])(
  "service failure %s returns 500 with the same ID passed to the service",
  async (cause) => {
    const uploadRepository = vi
      .fn<IUploadService["uploadRepository"]>()
      .mockRejectedValue(cause);
    const app = createDeployRoutes({ uploadRepository });

    const response = await post(app, { repoUrl: "/tmp/repo" });

    expect(response.status).toBe(500);
    const id = uploadRepository.mock.calls[0]?.[0].id;
    expect(id).toMatch(ID_PATTERN);
    expect(await response.json()).toEqual({ id });
    expect(uploadRepository).toHaveBeenCalledExactlyOnceWith({
      id,
      onProgress: expect.any(Function),
      repoUrl: "/tmp/repo",
    });
  }
);
