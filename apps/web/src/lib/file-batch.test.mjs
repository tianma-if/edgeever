import { describe, expect, test } from "bun:test";
import { createFileBatchQueue, processFileUploadBatch, processFilesSequentially } from "./file-batch.ts";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("prepares two files independently of four uploads with bounded buffering", async () => {
  const files = Array.from({ length: 12 }, (_, i) => new File([String(i)], String(i)));
  const preparations = files.map(deferred);
  const uploads = files.map(deferred);
  const startedPreparing = [];
  const startedUploading = [];
  let preparing = 0, uploading = 0, inFlight = 0;
  let maxPreparing = 0, maxUploading = 0, maxInFlight = 0;
  const completion = processFileUploadBatch(files, async (file) => {
    const index = Number(file.name);
    startedPreparing.push(index);
    maxPreparing = Math.max(maxPreparing, ++preparing);
    maxInFlight = Math.max(maxInFlight, ++inFlight);
    await preparations[index].promise;
    preparing--;
    return new File(["compressed"], `${file.name}.webp`);
  }, async (preparedFile, originalFile) => {
    const index = Number(originalFile.name);
    expect(preparedFile.name).toBe(`${originalFile.name}.webp`);
    startedUploading.push(index);
    maxUploading = Math.max(maxUploading, ++uploading);
    await uploads[index].promise;
    uploading--;
    inFlight--;
    return `uploaded:${originalFile.name}`;
  });

  await tick();
  expect(startedPreparing).toEqual([0, 1]);
  preparations[0].resolve(); preparations[1].resolve();
  await tick();
  expect(startedUploading).toEqual([0, 1]);
  expect(startedPreparing).toEqual([0, 1, 2, 3]);
  preparations[2].resolve(); preparations[3].resolve();
  await tick();
  expect(startedUploading).toEqual([0, 1, 2, 3]);
  expect(startedPreparing).toEqual([0, 1, 2, 3, 4, 5]);
  preparations[4].resolve(); preparations[5].resolve();
  await tick();
  // The stalled network may hold two prepared files, but not the whole batch.
  expect(startedPreparing).toHaveLength(6);
  expect(startedUploading).toHaveLength(4);
  uploads[3].resolve();
  await tick();
  expect(startedPreparing).toHaveLength(7);
  expect(startedUploading).toEqual([0, 1, 2, 3, 4]);

  preparations.forEach(({ resolve }) => resolve());
  uploads.forEach(({ resolve }) => resolve());
  const results = await completion;
  expect(maxPreparing).toBe(2);
  expect(maxUploading).toBe(4);
  expect(maxInFlight).toBe(6);
  expect(results.map(({ file }) => file)).toEqual(files);
  expect(results.map(({ value }) => value)).toEqual(files.map((file) => `uploaded:${file.name}`));
});

test("continues after failures in either phase without losing original file order", async () => {
  const files = Array.from({ length: 10 }, (_, i) => new File([String(i)], String(i)));
  const uploadAttempts = [];
  const results = await processFileUploadBatch(files, async (file) => {
    if (file.name === "0") throw new Error("preparation failed");
    return new File(["compressed"], `${file.name}.webp`);
  }, async (preparedFile, originalFile) => {
    uploadAttempts.push(originalFile.name);
    if (originalFile.name === "2") throw new Error("upload failed");
    return preparedFile.name;
  });
  expect(uploadAttempts).not.toContain("0");
  expect(uploadAttempts).toHaveLength(9);
  expect(results.map(({ file }) => file)).toEqual(files);
  expect(results[0]).toMatchObject({ status: "rejected", reason: new Error("preparation failed") });
  expect(results[2]).toMatchObject({ status: "rejected", reason: new Error("upload failed") });
  expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(8);
  expect(results[9]).toMatchObject({ status: "fulfilled", value: "9.webp" });
});

describe("processFilesSequentially", () => {
  test("continues after a failed file and preserves selection order", async () => {
    const files = [
      new File(["a"], "first.jpg", { type: "image/jpeg" }),
      new File(["b"], "broken.jpg", { type: "image/jpeg" }),
      new File(["c"], "last.jpg", { type: "image/jpeg" }),
    ];
    const processed = [];

    const results = await processFilesSequentially(files, async (file) => {
      processed.push(file.name);
      if (file.name === "broken.jpg") {
        throw new Error("upload failed");
      }
      return `${file.name}:uploaded`;
    });

    expect(processed).toEqual(["first.jpg", "broken.jpg", "last.jpg"]);
    expect(results.map(({ file, status }) => [file.name, status])).toEqual([
      ["first.jpg", "fulfilled"],
      ["broken.jpg", "rejected"],
      ["last.jpg", "fulfilled"],
    ]);
    expect(results[2]).toMatchObject({ status: "fulfilled", value: "last.jpg:uploaded" });
  });

  test("serializes separate batches triggered by rapid consecutive pastes", async () => {
    const queue = createFileBatchQueue();
    const events = [];
    let finishFirst;
    let markFirstStarted;
    const firstCanFinish = new Promise((resolve) => {
      finishFirst = resolve;
    });
    const firstStarted = new Promise((resolve) => {
      markFirstStarted = resolve;
    });

    const first = queue(async () => {
      events.push("first:start");
      markFirstStarted();
      await firstCanFinish;
      events.push("first:end");
    });
    const second = queue(async () => {
      events.push("second:start");
      events.push("second:end");
    });

    await firstStarted;
    expect(events).toEqual(["first:start"]);
    finishFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });
});
