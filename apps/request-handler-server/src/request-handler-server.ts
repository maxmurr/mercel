import { GetObjectCommand, S3ServiceException } from "@aws-sdk/client-s3";
import { idPattern } from "@repo/utils/id";
import { s3 } from "@repo/utils/s3";
import { file } from "bun";
import { Elysia } from "elysia";
import { initLogger, log as logger } from "evlog";
import { evlog } from "evlog/elysia";

initLogger({ env: { service: "mercel-request-handler-server" } });

const bucket = process.env.S3_BUCKET;
if (!bucket) {
  throw new Error("Request handler configuration missing: set S3_BUCKET.");
}

const unsafeFilePathCharacters = /[\\\0]/;

/**
 * Serves application files from S3 keys under dist/<id>/ using the first hostname label as the ID.
 * Hostnames arrive lowercased, so legacy mixed-case IDs are unreachable until their keys are lowercased.
 */
export const requestHandlerServer = new Elysia()
  .use(evlog())
  .get("/*", async ({ request, log, status }) => {
    const { hostname, pathname } = new URL(request.url);
    const [id] = hostname.split(".");
    log.set({ filePath: pathname, hostname, id });
    if (!(id && idPattern.test(id))) {
      return status(400, "Invalid application ID");
    }

    let filePath = pathname;
    try {
      filePath = decodeURIComponent(
        pathname === "/" ? "/index.html" : pathname
      );
    } catch {
      return status(400, "Invalid file path");
    }
    const hasUnsafeCharacter = unsafeFilePathCharacters.test(filePath);
    const hasUnsafeSegment = filePath
      .split("/")
      .some((part) => part === "." || part === "..");
    if (hasUnsafeCharacter || hasUnsafeSegment) {
      return status(400, "Invalid file path");
    }
    log.set({ filePath });

    try {
      const { Body: body } = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: `dist/${id}${filePath}` })
      );
      if (!body) {
        throw new Error("Request handler S3 response body missing.");
      }
      return new Response(body.transformToWebStream(), {
        headers: {
          "Content-Type": file(filePath).type,
          // Mark streamed bodies so evlog waits for completion and captures read errors.
          "Transfer-Encoding": "chunked",
        },
      });
    } catch (error) {
      if (
        error instanceof S3ServiceException &&
        error.$metadata.httpStatusCode === 404
      ) {
        return status(404, "File not found");
      }
      log.error(error instanceof Error ? error : new Error(String(error)));
      return status(502, "File unavailable");
    }
  });

if (import.meta.main) {
  requestHandlerServer.listen(process.env.PORT ?? 3001, (server) => {
    logger.info({
      action: "server_start",
      hostname: server.hostname,
      port: server.port,
    });
  });
}
