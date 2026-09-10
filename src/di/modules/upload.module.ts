import { createModule } from "@evyweb/ioctopus";
import { UploadService } from "../../services/upload.service.ts";
import { DI_SYMBOLS } from "../types.ts";

/** Binds the upload service to the shared queue. */
export function createUploadModule() {
  const uploadModule = createModule();
  uploadModule
    .bind(DI_SYMBOLS.IUploadService)
    .toClass(UploadService, [DI_SYMBOLS.JobQueue]);
  return uploadModule;
}
