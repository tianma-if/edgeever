import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

describe("Xcode Cloud control", () => {
  test("exposes start, wait, and VALID-build resolution for store delivery", () => {
    const script = readFileSync(
      new URL("./xcode-cloud-control.py", import.meta.url),
      "utf8",
    );
    const workflow = readFileSync(
      new URL("../.github/workflows/store-delivery.yml", import.meta.url),
      "utf8",
    );
    const cloudWorkflow = readFileSync(
      new URL("../.github/workflows/ios-xcode-cloud.yml", import.meta.url),
      "utf8",
    );

    expect(script).toContain('sub.add_parser("start"');
    expect(script).toContain('sub.add_parser("wait"');
    expect(script).toContain('sub.add_parser("describe"');
    expect(script).toContain("/issues?limit=50");
    expect(script).toContain("--wait-valid");
    expect(script).toContain("--require-sha");
    expect(script).toContain("sourceBranchOrTag");
    expect(script).toContain("processingState");
    expect(script).toContain('emit("build_number"');
    expect(script).not.toContain("APP_STORE_BUILD_NUMBER: \"49\"");

    expect(workflow).toContain(".edgeever-ci/scripts/xcode-cloud-control.py");
    expect(workflow).toContain("--wait-valid");
    expect(workflow).toContain("git show \"$source_sha:apps/ios/Config/Version.xcconfig\"");

    expect(cloudWorkflow).toContain("scripts/xcode-cloud-control.py");
    expect(cloudWorkflow).toContain("describe");
    expect(cloudWorkflow).not.toContain("submit-review");
    expect(cloudWorkflow).not.toContain('APP_STORE_BUILD_NUMBER: "49"');
  });

  test("keeps iOS marketing version in Version.xcconfig instead of project.yml", () => {
    const projectYml = readFileSync(
      new URL("../apps/ios/project.yml", import.meta.url),
      "utf8",
    );
    const preXcodebuild = readFileSync(
      new URL("../apps/ios/ci_scripts/ci_pre_xcodebuild.sh", import.meta.url),
      "utf8",
    );
    const pbxproj = readFileSync(
      new URL("../apps/ios/EdgeEver.xcodeproj/project.pbxproj", import.meta.url),
      "utf8",
    );
    const xcconfig = readFileSync(
      new URL("../apps/ios/Config/Version.xcconfig", import.meta.url),
      "utf8",
    );
    const marketing = xcconfig.match(/^MARKETING_VERSION\s*=\s*(\S+)/m)?.[1];

    expect(projectYml).not.toMatch(/MARKETING_VERSION\s*:/);
    expect(preXcodebuild).toContain("Stamped MARKETING_VERSION=");
    expect(marketing).toBeTruthy();
    expect(pbxproj).not.toContain("MARKETING_VERSION = 1.74.0;");
    expect(pbxproj).toContain(`MARKETING_VERSION = ${marketing};`);
  });

  test("cancels only the matching single-item review with a valid replacement build", () => {
    const program = `
import argparse, importlib.util
spec = importlib.util.spec_from_file_location("cloud", "scripts/xcode-cloud-control.py")
cloud = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cloud)
class Client:
    app_id = "app"
    def __init__(self, linked="old", items=1):
        self.linked, self.items, self.patches = linked, items, []
    def request(self, method, path, body=None):
        if method == "PATCH":
            self.patches.append((path, body))
            return {"data": {"attributes": {"state": "CANCELING"}}}
        if "/appStoreVersions?" in path:
            return {"data": [{"id": "version", "attributes": {"appStoreState": "WAITING_FOR_REVIEW"},
                "relationships": {"build": {"data": {"id": self.linked}}}}]}
        if "/builds/new?" in path:
            return {"data": {"attributes": {"processingState": "VALID"}}}
        if "/builds/new/preReleaseVersion" in path:
            return {"data": {"attributes": {"version": "1.98.0"}}}
        if "/reviewSubmissions?" in path:
            return {"data": [{"id": "submission", "relationships": {
                "appStoreVersionForReview": {"data": {"id": "version"}}}}]}
        if "/reviewSubmissions/submission/items" in path:
            assert "fields%5BreviewSubmissionItems%5D=state%2CappStoreVersion" in path
            assert "include=appStoreVersion" in path
            return {"data": [{"relationships": {"appStoreVersion": {"data": {"id": "version"}}}}] * self.items}
        raise AssertionError(path)
args = argparse.Namespace(version="1.98.0", current_build_id="old", replacement_build_id="new")
good = Client()
cloud.command_cancel_review(args, good)
assert len(good.patches) == 1
assert good.patches[0][1]["data"]["attributes"] == {"canceled": True}
for unsafe in (Client(linked="changed"), Client(items=2)):
    try:
        cloud.command_cancel_review(args, unsafe)
    except SystemExit:
        pass
    else:
        raise AssertionError("Unsafe review was not rejected")
    assert unsafe.patches == []
`;
    const result = spawnSync("python3", ["-c", program], { encoding: "utf8" });
    expect(result.status).toBe(0);
  });
});
