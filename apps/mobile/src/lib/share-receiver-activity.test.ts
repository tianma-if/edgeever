import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { setAndroidIntentFilters, SHARE_RECEIVER_ACTIVITY } from "../../node_modules/expo-sharing/plugin/build/android/withAndroidIntentFilters.js";

import { parseIntentFilters } from "../../node_modules/expo-sharing/plugin/build/android/parseIntentFilters.js";

const appConfig = JSON.parse(readFileSync(new URL("../../app.json", import.meta.url), "utf8"));
const [, { android }] = appConfig.expo.plugins.find((plugin) => plugin[0] === "expo-sharing");
const sendFilters = [
  parseIntentFilters(android.singleShareMimeTypes, "single"),
  parseIntentFilters(android.multipleShareMimeTypes, "multiple"),
];

function manifestConfig() {
  return {
    modResults: {
      manifest: {
        application: [
          {
            $: { "android:name": ".MainApplication" },
            activity: [
              {
                $: { "android:name": ".MainActivity", "android:launchMode": "singleTask" },
                "intent-filter": [
                  {
                    action: [{ $: { "android:name": "android.intent.action.MAIN" } }],
                    category: [{ $: { "android:name": "android.intent.category.LAUNCHER" } }],
                  },
                  {
                    $: { "expo-sharing-intent-filters": "true" },
                    action: [{ $: { "android:name": "android.intent.action.SEND" } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  };
}

describe("Android share receiver manifest", () => {
  test("moves SEND filters off the singleTask host", () => {
    const config = manifestConfig();
    setAndroidIntentFilters(config, sendFilters);
    const activities = config.modResults.manifest.application[0].activity;
    const main = activities.find((activity) => activity.$["android:name"] === ".MainActivity");
    const receiver = activities.find((activity) => activity.$["android:name"] === SHARE_RECEIVER_ACTIVITY);
    expect(main["intent-filter"]).toHaveLength(1);
    expect(main["intent-filter"][0].action[0].$["android:name"]).toBe("android.intent.action.MAIN");
    expect(receiver.$["android:launchMode"]).toBe("standard");
    expect(receiver.$["android:taskAffinity"]).toBe("");
    expect(receiver.$["android:noHistory"]).toBe("true");
    expect(receiver["intent-filter"].map((filter) => filter.action[0].$["android:name"])).toEqual([
      "android.intent.action.SEND",
      "android.intent.action.SEND_MULTIPLE",
    ]);
    const mimeTypes = receiver["intent-filter"].map((filter) => filter.data.map((data) => data.$["android:mimeType"]));
    expect(mimeTypes).toEqual([
      ["text/plain", "image/*", "application/zip", "application/x-zip-compressed", "application/octet-stream"],
      ["text/plain", "image/*"],
    ]);
  });

  test("removes the receiver when sharing is disabled", () => {
    const config = manifestConfig();
    setAndroidIntentFilters(config, sendFilters);
    setAndroidIntentFilters(config, []);
    const names = config.modResults.manifest.application[0].activity.map((activity) => activity.$["android:name"]);
    expect(names).toEqual([".MainActivity"]);
  });
});

test("share receiver copies a cold-start payload before opening the host", () => {
  const source = readFileSync(
    new URL("../../node_modules/expo-sharing/android/src/main/java/expo/modules/sharing/ShareIntoUtils.kt", import.meta.url),
    "utf8",
  );
  const body = source.slice(source.indexOf("class ShareReceiverActivity"));
  const copy = body.indexOf("materializeShareIntent");
  const publish = body.indexOf("publishSharedIntent");
  const open = body.indexOf("openShareHost");
  expect(copy).toBeGreaterThan(-1);
  expect(publish).toBeGreaterThan(copy);
  expect(open).toBeGreaterThan(publish);
});
