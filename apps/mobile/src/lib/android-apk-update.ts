import type { MobileRelease } from "./mobile-release";
import { installAndroidApk } from "../../modules/edgeever-app-installer";

export type AndroidApkDownloadProgress = {
  downloadedBytes: number;
  progress: number;
  totalBytes: number;
};

export const downloadAndroidApk = async (
  release: MobileRelease,
  onProgress: (progress: AndroidApkDownloadProgress) => void
) => {
  const { File, Paths } = await import("expo-file-system");
  const destination = new File(Paths.cache, release.fileName);

  if (destination.exists && destination.size === release.size) {
    onProgress({ downloadedBytes: release.size, progress: 1, totalBytes: release.size });
    return destination.uri;
  }

  if (destination.exists) {
    destination.delete();
  }

  try {
    const downloadedFile = await File.downloadFileAsync(release.downloadUrl, destination, {
      idempotent: true,
      onProgress: ({ bytesWritten, totalBytes }) => {
        const expectedBytes = totalBytes > 0 ? totalBytes : release.size;
        onProgress({
          downloadedBytes: bytesWritten,
          progress: expectedBytes > 0 ? Math.min(bytesWritten / expectedBytes, 1) : 0,
          totalBytes: expectedBytes,
        });
      },
    });

    if (downloadedFile.size !== release.size) {
      throw new Error(`Downloaded APK size mismatch: expected ${release.size}, received ${downloadedFile.size}`);
    }

    onProgress({ downloadedBytes: release.size, progress: 1, totalBytes: release.size });
    return downloadedFile.uri;
  } catch (error) {
    if (destination.exists) {
      destination.delete();
    }
    throw error;
  }
};

export const installDownloadedAndroidApk = async (fileUri: string) => {
  const installerOpened = await installAndroidApk(fileUri);
  if (!installerOpened) {
    throw new Error("Permission to install apps was not granted");
  }
};
