import type { MobileInstallUpdateSource } from "./mobile-release";
import type { GooglePlayOpenResult } from "../../modules/edgeever-app-store";

type MobileUpdateDestinationDependencies = {
  openGooglePlayDetails: (applicationId: string) => GooglePlayOpenResult | Promise<GooglePlayOpenResult>;
  openUrl: (url: string) => Promise<unknown>;
};

type GooglePlayOpenFailure = Exclude<GooglePlayOpenResult, "opened">;

export type MobileUpdateDestinationResult =
  | { status: "opened" }
  | {
    reason: "not-installed";
    status: "google-play-unavailable";
  }
  | {
    fallbackUrl: string;
    reason: Exclude<GooglePlayOpenFailure, "not-installed">;
    status: "google-play-unavailable";
  };

export const openMobileInstallUpdateSource = async (
  source: MobileInstallUpdateSource,
  dependencies: MobileUpdateDestinationDependencies
): Promise<MobileUpdateDestinationResult> => {
  if (source.id === "google-play") {
    let result: GooglePlayOpenResult;
    try {
      result = await dependencies.openGooglePlayDetails(source.applicationId);
    } catch {
      result = "unavailable";
    }
    if (result === "opened") {
      return { status: "opened" };
    }
    if (result === "not-installed") {
      return {
        reason: result,
        status: "google-play-unavailable",
      };
    }
    return {
      fallbackUrl: source.fallbackUrl,
      reason: result,
      status: "google-play-unavailable",
    };
  }

  await dependencies.openUrl(source.url);
  return { status: "opened" };
};
