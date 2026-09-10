import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { expect, test } from "vitest";
import { getFilePaths } from "./file-paths.ts";

test("getFilePaths lists nested files, skips symlinks, and rejects invalid directories", async () => {
  const directoryPath = await mkdtemp(join(tmpdir(), "mercel-file-paths-"));

  try {
    const nestedDirectory = join(directoryPath, "nested", "deeper");
    const emptyDirectory = join(directoryPath, "empty");
    await mkdir(nestedDirectory, { recursive: true });
    await mkdir(emptyDirectory);

    const expectedPaths = [
      join(directoryPath, ".hidden"),
      join(directoryPath, "README.md"),
      join(nestedDirectory, "file with spaces.txt"),
    ].sort();
    await Promise.all(
      expectedPaths.map((filePath) => writeFile(filePath, "test"))
    );
    await symlink(
      join(directoryPath, "README.md"),
      join(directoryPath, "link")
    );
    await symlink(directoryPath, join(nestedDirectory, "cycle"), "dir");

    expect((await getFilePaths({ directoryPath })).sort()).toEqual(
      expectedPaths
    );
    expect(
      (
        await getFilePaths({
          directoryPath: relative(process.cwd(), directoryPath),
        })
      ).sort()
    ).toEqual(expectedPaths);
    expect(await getFilePaths({ directoryPath: emptyDirectory })).toEqual([]);
    await expect(
      getFilePaths({ directoryPath: join(directoryPath, "missing") })
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      getFilePaths({ directoryPath: join(directoryPath, "README.md") })
    ).rejects.toMatchObject({
      code: "ENOTDIR",
    });
  } finally {
    await rm(directoryPath, { force: true, recursive: true });
  }
});
