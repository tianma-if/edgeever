import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const loginSurfaces = [
  "apps/ios/EdgeEver/Features/Auth/LoginView.swift",
  "apps/mobile/src/screens/LoginScreen.tsx",
  "apps/web/src/components/LoginScreen.tsx",
];

const reviewNotes = [
  "apps/mobile/store-assets/app-store/metadata.en-US.md",
  "apps/mobile/store-assets/app-store/metadata.zh-CN.md",
];

describe("App Review login", () => {
  test("does not offer a fake example.com host as the instance placeholder", () => {
    for (const path of [...loginSurfaces, ...reviewNotes]) {
      expect(read(path), path).not.toContain("notes.example.com");
    }
  });

  test("uses the public demo instance as the login placeholder", () => {
    expect(read("packages/shared/src/public-demo.ts")).toContain('export const PUBLIC_DEMO_INSTANCE_URL = "https://demo.edgeever.org"');
    expect(read("apps/ios/EdgeEver/Supporting/URL+Normalize.swift")).toContain('static let instanceURLString = "https://demo.edgeever.org"');
    expect(read("apps/ios/EdgeEver/Features/Auth/LoginView.swift")).toContain("EdgeEverPublicDemo.instanceURLString");
    expect(read("apps/mobile/src/screens/LoginScreen.tsx")).toContain("PUBLIC_DEMO_INSTANCE_URL");
    expect(read("apps/mobile/src/screens/LoginScreen.tsx")).toContain("placeholder={PUBLIC_DEMO_INSTANCE_URL}");
    expect(read("packages/shared/src/i18n/en-US.ts")).toContain('instanceUrlPlaceholder: "https://demo.edgeever.org"');
    expect(read("packages/shared/src/i18n/zh-CN.ts")).toContain('instanceUrlPlaceholder: "https://demo.edgeever.org"');
    expect(read("apps/web/src/components/LoginScreen.tsx")).toContain('placeholder={t("login.instanceUrlPlaceholder")}');
  });

  test("puts the public demo URL and credentials in App Review notes", () => {
    for (const path of reviewNotes) {
      expect(read(path), path).toContain("https://demo.edgeever.org");
    }
    expect(read("apps/mobile/store-assets/app-store/metadata.en-US.md")).toContain("Username: ee-demo");
    expect(read("apps/mobile/store-assets/app-store/metadata.zh-CN.md")).toContain("用户名：ee-demo");
  });
});
