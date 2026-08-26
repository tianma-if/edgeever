import { beforeEach, expect, mock, test } from "bun:test";
import type { MobileRelease } from "./mobile-release";

const cachedFileSizes = new Map<string, number>();
const installerCalls: string[] = [];
let downloadCalls = 0;
let installerResult = true;

class MockFile {
  readonly uri: string;

  constructor(directory: string, fileName: string) {
    this.uri = `${directory}/${fileName}`;
  }

  get exists() {
    return cachedFileSizes.has(this.uri);
  }

  get size() {
    return cachedFileSizes.get(this.uri) ?? 0;
  }

  delete() {
    cachedFileSizes.delete(this.uri);
  }

  static async downloadFileAsync(
    _url: string,
    destination: MockFile,
    options: { onProgress: (progress: { bytesWritten: number; totalBytes: number }) => void }
  ) {
    downloadCalls += 1;
    options.onProgress({ bytesWritten: 24_000_000, totalBytes: 48_000_000 });
    cachedFileSizes.set(destination.uri, 48_000_000);
    return destination;
  }
}

mock.module("expo-file-system", () => ({
  File: MockFile,
  Paths: { cache: "file:///cache" },
}));

mock.module("../../modules/edgeever-app-installer", () => ({
  installAndroidApk: async (fileUri: string) => {
    installerCalls.push(fileUri);
    return installerResult;
  },
}));

const { downloadAndroidApk, installDownloadedAndroidApk } = await import("./android-apk-update");

const release: MobileRelease = {
  digest: `sha256:${"a".repeat(64)}`,
  downloadUrl: "https://github.com/tianma-if/edgeever/releases/download/v1.40.0/edgeever-android-v1.40.0-arm64-v8a.apk",
  fileName: "edgeever-android-v1.40.0-arm64-v8a.apk",
  size: 48_000_000,
  version: "1.40.0",
};

beforeEach(() => {
  cachedFileSizes.clear();
  installerCalls.length = 0;
  downloadCalls = 0;
  installerResult = true;
});

test("downloads the APK without opening the installer", async () => {
  const progress: number[] = [];
  const fileUri = await downloadAndroidApk(release, ({ progress: value }) => progress.push(value));

  expect(fileUri).toBe(`file:///cache/${release.fileName}`);
  expect(downloadCalls).toBe(1);
  expect(installerCalls).toEqual([]);
  expect(progress).toEqual([0.5, 1]);
});

test("reuses a complete cached APK", async () => {
  const cachedUri = `file:///cache/${release.fileName}`;
  cachedFileSizes.set(cachedUri, release.size);
  const progress: number[] = [];

  expect(await downloadAndroidApk(release, ({ progress: value }) => progress.push(value))).toBe(cachedUri);
  expect(downloadCalls).toBe(0);
  expect(progress).toEqual([1]);
});

test("opens the installer only after the prepared APK is accepted", async () => {
  const fileUri = `file:///cache/${release.fileName}`;

  await installDownloadedAndroidApk(fileUri);
  expect(installerCalls).toEqual([fileUri]);

  installerResult = false;
  await expect(installDownloadedAndroidApk(fileUri)).rejects.toThrow("Permission to install apps was not granted");
});
