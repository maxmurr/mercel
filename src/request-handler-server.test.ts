import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { initLogger } from "evlog";
import { expect, test, vi } from "vitest";

const REQUEST_HANDLER_SERVER_PATH = fileURLToPath(
  new URL("./request-handler-server.ts", import.meta.url)
);

const html = Buffer.from(
  "<!doctype html><html><body>Deployed app</body></html>"
);
const files = [
  { body: html, filePath: "index.html", mimeType: "text/html" },
  {
    body: Buffer.from("export default 1;"),
    filePath: "assets/app.js",
    mimeType: "javascript",
  },
  {
    body: Buffer.from("body { color: red; }"),
    filePath: "assets/app.css",
    mimeType: "text/css",
  },
  {
    body: Buffer.from([0, 255, 1, 128]),
    filePath: "assets/logo.png",
    mimeType: "image/png",
  },
  { body: html, filePath: "page with spaces.html", mimeType: "text/html" },
];

test("request handler rejects missing S3_BUCKET", () => {
  const result = spawnSync("bun", [REQUEST_HANDLER_SERVER_PATH], {
    env: { ...process.env, S3_BUCKET: "" },
    timeout: 5000,
  });

  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stderr.toString()).toContain(
    "Request handler configuration missing: set S3_BUCKET."
  );
});

test("request handler serves S3 files with MIME types and keeps requests inside the application prefix", async ({
  onTestFinished,
}) => {
  const requestedKeys: string[] = [];
  const s3Server = createServer((request, response) => {
    const key = decodeURIComponent(
      new URL(request.url ?? "/", "http://localhost").pathname
    );
    requestedKeys.push(key);
    const file = files.find(
      ({ filePath }) => key === `/test-bucket/dist/abc12/${filePath}`
    );
    if (file) {
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      response.end(file.body);
      return;
    }
    if (key.endsWith("/denied.html")) {
      response.writeHead(403, { "Content-Type": "application/xml" });
      response.end("<Error><Code>AccessDenied</Code></Error>");
      return;
    }
    response.writeHead(404, { "Content-Type": "application/xml" });
    response.end("<Error><Code>NoSuchKey</Code></Error>");
  });

  try {
    s3Server.listen(0, "127.0.0.1");
    await once(s3Server, "listening");
    const address = s3Server.address();
    assert(address && typeof address !== "string");
    vi.stubEnv("S3_ENDPOINT", `http://127.0.0.1:${address.port}`);
    vi.stubEnv("S3_BUCKET", "test-bucket");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "test-access-key");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "test-secret-key");
    vi.stubEnv("AWS_SESSION_TOKEN", "");
    const { requestHandlerServer } = await import(
      "./request-handler-server.ts"
    );
    const { s3 } = await import("./utils/s3.ts");
    onTestFinished(() => s3.destroy());
    initLogger({ silent: true });

    const home = await requestHandlerServer.handle(
      new Request("http://abc12.localhost:3001/")
    );
    expect(home.status).toBe(200);
    expect(home.headers.get("content-type")).toContain("text/html");
    expect(await home.text()).toBe(html.toString());
    expect(requestedKeys[0]).toBe("/test-bucket/dist/abc12/index.html");

    await Promise.all(
      files.map(async ({ body, filePath, mimeType }) => {
        const response = await requestHandlerServer.handle(
          new Request(`http://abc12.example.com/${filePath}?cache=1`)
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain(mimeType);
        expect(Buffer.from(await response.arrayBuffer())).toEqual(body);
        expect(requestedKeys).toContain(`/test-bucket/dist/abc12/${filePath}`);
      })
    );

    const missing = await requestHandlerServer.handle(
      new Request("http://abc12.example.com/missing.html")
    );
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("File not found");

    const denied = await requestHandlerServer.handle(
      new Request("http://abc12.example.com/denied.html")
    );
    expect(denied.status).toBe(502);
    expect(await denied.text()).toBe("File unavailable");

    const requestCount = requestedKeys.length;
    await Promise.all(
      [
        "http://localhost/index.html",
        "http://bad-id.example.com/index.html",
        "http://abc12.example.com/%2e%2e%2fother/index.html",
        "http://abc12.example.com/assets/%5c..%5cindex.html",
        "http://abc12.example.com/bad%00path",
        "http://abc12.example.com/bad%ZZ",
      ].map(async (url) => {
        const response = await requestHandlerServer.handle(new Request(url));
        expect(response.status).toBe(400);
      })
    );
    expect(requestedKeys).toHaveLength(requestCount);
  } finally {
    vi.unstubAllEnvs();
    const closed = once(s3Server, "close");
    s3Server.close();
    await closed;
  }
});
