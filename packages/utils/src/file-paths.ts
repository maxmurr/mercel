import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Options for recursively listing files in a directory.
 */
interface GetFilePathsOptions {
  /**
   * The absolute or relative path to the directory to search.
   * Relative paths resolve from the current working directory.
   * @example "/project/src"
   */
  directoryPath: string;
}

/**
 * Returns absolute file paths recursively, including hidden files but excluding symlinks.
 * @param options The options for searching the directory.
 * @returns The absolute file paths, or an empty array if no files are found.
 * @throws If the directory or any nested directory cannot be read.
 * @example
 * await getFilePaths({ directoryPath: "/project/src" }); // e.g. ["/project/src/index.ts"]
 */
export async function getFilePaths({
  directoryPath,
}: GetFilePathsOptions): Promise<string[]> {
  const absolutePath = resolve(directoryPath);
  const entries = await readdir(absolutePath, { withFileTypes: true });
  const filePaths = await Promise.all(
    entries.map((entry) => {
      const entryPath = join(absolutePath, entry.name);
      if (entry.isDirectory()) {
        return getFilePaths({ directoryPath: entryPath });
      }
      return entry.isFile() ? [entryPath] : [];
    })
  );

  return filePaths.flat();
}
