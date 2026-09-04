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

const FILE_PREPARATION_CONCURRENCY = 2;
const FILE_UPLOAD_CONCURRENCY = 4;

/** Keep the network busy without accumulating an entire batch of compressed blobs. */
export const processFileUploadBatch = async <T>(
  files: File[],
  prepareFile: (file: File) => Promise<File>,
  uploadFile: (preparedFile: File, originalFile: File) => Promise<T>,
): Promise<FileBatchResult<T>[]> => {
  const prepare = pLimit(FILE_PREPARATION_CONCURRENCY);
  const upload = pLimit(FILE_UPLOAD_CONCURRENCY);
  // Four uploads plus two files being prepared or waiting to upload. When the
  // network stalls, stop preparing more files until an upload releases a slot.
  const inFlight = pLimit(FILE_PREPARATION_CONCURRENCY + FILE_UPLOAD_CONCURRENCY);
  return Promise.all(files.map((file) => inFlight(async (): Promise<FileBatchResult<T>> => {
    try {
      const preparedFile = await prepare(() => prepareFile(file));
      const value = await upload(() => uploadFile(preparedFile, file));
      return { file, status: "fulfilled", value };
    } catch (reason) {
      return { file, status: "rejected", reason };
    }
  })));
};

/** Serialize separate paste/drop batches so each reads the post-insert cursor. */
export const createFileBatchQueue = () => {
  const limit = pLimit(1);
  return <T>(task: () => Promise<T>) => limit(task);
};
