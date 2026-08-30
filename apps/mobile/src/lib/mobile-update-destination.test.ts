import { expect, test } from "bun:test";
import { ANDROID_INSTALL_UPDATE_SOURCES, GOOGLE_PLAY_WEB_URL } from "./mobile-release";
import { openMobileInstallUpdateSource } from "./mobile-update-destination";

const googlePlay = ANDROID_INSTALL_UPDATE_SOURCES.find((source) => source.id === "google-play");
const github = ANDROID_INSTALL_UPDATE_SOURCES.find((source) => source.id === "github");

if (!googlePlay || !github) {
  throw new Error("Android update sources are incomplete");
}

test("opens the app listing directly in Google Play without invoking a generic URL handler", async () => {
  const openedApplicationIds: string[] = [];
  const openedUrls: string[] = [];

  const result = await openMobileInstallUpdateSource(googlePlay, {
    openGooglePlayDetails: (applicationId) => {
      openedApplicationIds.push(applicationId);
      return "opened";
    },
    openUrl: async (url) => {
      openedUrls.push(url);
    },
  });

  expect(openedApplicationIds).toEqual(["org.edgeever.mobile"]);
  expect(openedUrls).toEqual([]);
  expect(result).toEqual({ status: "opened" });
});

test("reports that Google Play is not installed without opening a browser automatically", async () => {
  const openedUrls: string[] = [];

  const result = await openMobileInstallUpdateSource(googlePlay, {
    openGooglePlayDetails: () => "not-installed",
    openUrl: async (url) => {
      openedUrls.push(url);
    },
  });

  expect(result).toEqual({
    reason: "not-installed",
    status: "google-play-unavailable",
  });
  expect(openedUrls).toEqual([]);
});

test("preserves the disabled Google Play reason", async () => {
  const result = await openMobileInstallUpdateSource(googlePlay, {
    openGooglePlayDetails: () => "disabled",
    openUrl: async () => undefined,
  });

  expect(result).toEqual({
    fallbackUrl: GOOGLE_PLAY_WEB_URL,
    reason: "disabled",
    status: "google-play-unavailable",
  });
});

test("reports Google Play as unavailable when the native launch fails unexpectedly", async () => {
  const openedUrls: string[] = [];

  const result = await openMobileInstallUpdateSource(googlePlay, {
    openGooglePlayDetails: () => {
      throw new Error("native module unavailable");
    },
    openUrl: async (url) => {
      openedUrls.push(url);
    },
  });

  expect(result).toEqual({
    fallbackUrl: GOOGLE_PLAY_WEB_URL,
    reason: "unavailable",
    status: "google-play-unavailable",
  });
  expect(openedUrls).toEqual([]);
});

test("opens GitHub through the regular URL handler", async () => {
  const openedUrls: string[] = [];

  const result = await openMobileInstallUpdateSource(github, {
    openGooglePlayDetails: () => {
      throw new Error("Google Play should not be called");
    },
    openUrl: async (url) => {
      openedUrls.push(url);
    },
  });

  expect(openedUrls).toEqual([github.url]);
  expect(result).toEqual({ status: "opened" });
});
