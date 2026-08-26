import { requireNativeModule } from "expo";

type EdgeEverAppInstallerNativeModule = {
  install: (fileUri: string) => Promise<boolean>;
};

/**
 * Opens Android's package installer, requesting per-app install permission first when required.
 * Returns false only when the user comes back without granting that permission.
 */
export const installAndroidApk = (fileUri: string) => {
  return requireNativeModule<EdgeEverAppInstallerNativeModule>("EdgeEverAppInstaller").install(fileUri);
};
