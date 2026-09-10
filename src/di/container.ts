import { createContainer } from "@evyweb/ioctopus";
import { createUploadModule } from "./modules/upload.module.ts";
import { type DI_RETURN_TYPES, DI_SYMBOLS } from "./types.ts";

/** Wires production services to the server-owned queue; call once after the queue is ready. */
export function createApplicationContainer(
  jobQueue: DI_RETURN_TYPES["JobQueue"]
) {
  const container = createContainer();
  container.bind(DI_SYMBOLS.JobQueue).toValue(jobQueue);
  container.load(Symbol("UploadModule"), createUploadModule());

  return {
    get<K extends keyof typeof DI_SYMBOLS>(symbol: K): DI_RETURN_TYPES[K] {
      return container.get(DI_SYMBOLS[symbol]);
    },
  };
}
