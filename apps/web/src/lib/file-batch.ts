import pLimit from "p-limit";

export type FileBatchResult<T> =
  | { file: File; status: "fulfilled"; value: T }
  | { file: File; status: "rejected"; reason: unknown };

export const processFilesSequentially = async <T>(
  files: File[],
  processFile: (file: File) => Promise<T>
): Promise<FileBatchResult<T>[]> => {
  const results: FileBatchResult<T>[] = [];

  for (const file of files) {
    try {
      results.push({ file, status: "fulfilled", value: await processFile(file) });
    } catch (reason) {
      results.push({ file, status: "rejected", reason });
    }
  }

  return results;
};

/** Serialize separate paste/drop batches so each reads the post-insert cursor. */
export const createFileBatchQueue = () => {
  const limit = pLimit(1);
  return <T>(task: () => Promise<T>) => limit(task);
};
