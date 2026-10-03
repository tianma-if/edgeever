#!/usr/bin/env python3
"""Start, monitor, and resolve Xcode Cloud App Store builds."""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


DEFAULT_APP_ID = "6792625631"
API_ROOT = "https://api.appstoreconnect.apple.com"


def emit(key: str, value) -> None:
    if value is None or value == "":
        return
    print(f"{key}={value}", flush=True)


def load_jwt():
    try:
        import jwt  # type: ignore
        return jwt
    except ImportError:
        import subprocess

        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "PyJWT", "cryptography", "-q"],
            stdout=subprocess.DEVNULL,
        )
        import jwt  # type: ignore

        return jwt


class AppStoreConnect:
    def __init__(self) -> None:
        self.app_id = os.environ.get("ASC_APP_ID", DEFAULT_APP_ID).strip()
        self.issuer = os.environ["ASC_API_ISSUER"]
        self.key_id = os.environ["ASC_API_KEY_ID"]
        raw_key = os.environ.get("ASC_API_KEY_BASE64", "").strip()
        if not raw_key:
            raise SystemExit("ASC_API_KEY_BASE64 is required")
        self.private_key = base64.b64decode(raw_key).decode()
        self.jwt = load_jwt()
        self.token = None
        self.token_exp = 0

    def ensure_token(self) -> str:
        now = int(time.time())
        if self.token and now < self.token_exp - 60:
            return self.token
        self.token_exp = now + 20 * 60
        encoded = self.jwt.encode(
            {
                "iss": self.issuer,
                "iat": now,
                "exp": self.token_exp,
                "aud": "appstoreconnect-v1",
            },
            self.private_key,
            algorithm="ES256",
            headers={"kid": self.key_id, "typ": "JWT"},
        )
        self.token = encoded.decode() if isinstance(encoded, bytes) else encoded
        return self.token

    def invalidate_token(self) -> None:
        self.token = None
        self.token_exp = 0

    def request(self, method: str, path_or_url: str, body=None, attempts: int = 5):
        url = (
            path_or_url
            if path_or_url.startswith("http")
            else API_ROOT + path_or_url
        )
        last_error = None
        for attempt in range(1, attempts + 1):
            request = urllib.request.Request(
                url,
                data=None if body is None else json.dumps(body).encode(),
                method=method,
            )
            request.add_header("Authorization", f"Bearer {self.ensure_token()}")
            if body is not None:
                request.add_header("Content-Type", "application/json")
            try:
                with urllib.request.urlopen(request) as response:
                    payload = response.read().decode()
                    return json.loads(payload) if payload else {}
            except urllib.error.HTTPError as error:
                details = error.read().decode()
                last_error = (
                    f"App Store Connect API {method} {path_or_url} "
                    f"failed ({error.code}): {details}"
                )
                if error.code in (401, 429, 500, 502, 503, 504) and attempt < attempts:
                    if error.code == 401:
                        self.invalidate_token()
                    print(
                        f"{last_error} retrying {attempt}/{attempts - 1}",
                        flush=True,
                    )
                    time.sleep(min(30, 2 ** attempt))
                    continue
                raise SystemExit(last_error)
        raise SystemExit(last_error or f"App Store Connect API {method} {path_or_url} failed")

    def collect(self, path: str) -> list:
        items = []
        next_path = path
        while next_path:
            payload = self.request("GET", next_path)
            items.extend(payload.get("data") or [])
            next_path = (payload.get("links") or {}).get("next")
        return items


def source_sha(run: dict) -> str:
    attributes = run.get("attributes") or {}
    commit = attributes.get("sourceCommit") or {}
    if isinstance(commit, dict):
        return str(commit.get("commitSha") or "")
    return ""


def select_archive_workflow(client: AppStoreConnect, workflow_id: str = "") -> dict:
    product = client.request("GET", f"/v1/apps/{client.app_id}/ciProduct").get("data")
    if not product:
        raise SystemExit("No Xcode Cloud product found for EdgeEver")
    workflows = client.collect(
        f"/v1/ciProducts/{product['id']}/workflows?"
        + urllib.parse.urlencode(
            {"limit": 50, "fields[ciWorkflows]": "name,isEnabled,lastModifiedDate"}
        )
    )
    if not workflows:
        raise SystemExit("No Xcode Cloud workflows found for EdgeEver")
    if workflow_id:
        matches = [workflow for workflow in workflows if workflow["id"] == workflow_id]
    else:
        matches = [
            workflow
            for workflow in workflows
            if (workflow.get("attributes") or {}).get("isEnabled")
            and re.search(
                r"archive|app\s*store|release",
                str((workflow.get("attributes") or {}).get("name", "")),
                re.IGNORECASE,
            )
        ]
    if len(matches) != 1:
        listing = "\n".join(
            f"- id={workflow['id']} name={(workflow.get('attributes') or {}).get('name')} "
            f"enabled={(workflow.get('attributes') or {}).get('isEnabled')}"
            for workflow in workflows
        )
        raise SystemExit(
            f"Expected exactly one matching enabled Archive workflow, found {len(matches)}.\n"
            f"{listing}"
        )
    return matches[0]


def list_git_references(client: AppStoreConnect, workflow_id: str) -> list:
    repository = client.request(
        "GET",
        f"/v1/ciWorkflows/{workflow_id}/repository",
    ).get("data")
    if not repository:
        raise SystemExit(f"Xcode Cloud workflow {workflow_id} has no repository")
    return client.collect(
        f"/v1/scmRepositories/{repository['id']}/gitReferences?limit=200"
    )


def canonical_git_ref(value: str) -> str:
    value = value.strip()
    if value.startswith("refs/"):
        return value
    if re.fullmatch(r"v\d+\.\d+\.\d+", value):
        return f"refs/tags/{value}"
    return f"refs/heads/{value}"


def find_git_reference(references: list, git_ref: str) -> dict | None:
    wanted = canonical_git_ref(git_ref)
    for reference in references:
        attributes = reference.get("attributes") or {}
        if attributes.get("isDeleted"):
            continue
        canonical = str(attributes.get("canonicalName") or "")
        name = str(attributes.get("name") or "")
        if canonical == wanted or name == git_ref or f"refs/tags/{name}" == wanted:
            return reference
        if f"refs/heads/{name}" == wanted:
            return reference
    return None


def resolve_git_reference(
    client: AppStoreConnect,
    workflow_id: str,
    git_ref: str,
    retries: int = 8,
) -> dict:
    last_names = []
    for attempt in range(1, retries + 1):
        references = list_git_references(client, workflow_id)
        last_names = [
            str((item.get("attributes") or {}).get("canonicalName") or "")
            for item in references
        ]
        match = find_git_reference(references, git_ref)
        if match:
            return match
        if attempt < retries:
            print(
                f"Xcode Cloud does not yet list {git_ref}; retrying {attempt}/{retries - 1}",
                flush=True,
            )
            time.sleep(min(30, 5 * attempt))
    sample = ", ".join(name for name in last_names[:12] if name)
    raise SystemExit(
        f"Xcode Cloud git reference {git_ref} was not found. Known refs: {sample}"
    )


def start_build(client: AppStoreConnect, workflow_id: str, git_reference_id: str | None) -> dict:
    relationships = {
        "workflow": {"data": {"type": "ciWorkflows", "id": workflow_id}},
    }
    if git_reference_id:
        relationships["sourceBranchOrTag"] = {
            "data": {"type": "scmGitReferences", "id": git_reference_id}
        }
    result = client.request(
        "POST",
        "/v1/ciBuildRuns",
        {
            "data": {
                "type": "ciBuildRuns",
                "attributes": {},
                "relationships": relationships,
            }
        },
    )
    build = result.get("data")
    if not build:
        raise SystemExit(f"Xcode Cloud did not return a build run: {result}")
    return build


def read_build_run(client: AppStoreConnect, build_run_id: str) -> dict:
    return client.request(
        "GET",
        f"/v1/ciBuildRuns/{build_run_id}?"
        + urllib.parse.urlencode(
            {
                "fields[ciBuildRuns]": (
                    "number,executionProgress,completionStatus,sourceCommit,"
                    "isPullRequestBuild,startReason"
                )
            }
        ),
    )["data"]


def wait_for_cloud_build(
    client: AppStoreConnect,
    build_run_id: str,
    require_sha: str,
    timeout_seconds: int,
) -> dict:
    deadline = time.time() + timeout_seconds
    sha_checked = False
    while True:
        run = read_build_run(client, build_run_id)
        attributes = run.get("attributes") or {}
        progress = attributes.get("executionProgress")
        completion = attributes.get("completionStatus")
        sha = source_sha(run)
        print(
            f"Xcode Cloud build #{attributes.get('number')} "
            f"progress={progress} completion={completion} sha={sha or 'pending'}",
            flush=True,
        )
        if require_sha and sha:
            if sha != require_sha:
                raise SystemExit(
                    f"Xcode Cloud source commit {sha} does not match required {require_sha}."
                )
            sha_checked = True
        if progress == "COMPLETE":
            if require_sha and not sha_checked:
                raise SystemExit(
                    f"Xcode Cloud build finished without a source commit; required {require_sha}."
                )
            if completion != "SUCCEEDED":
                describe_failed_run(client, build_run_id)
                raise SystemExit(f"Xcode Cloud build completed with {completion}")
            return run
        if time.time() >= deadline:
            raise SystemExit("Timed out waiting for Xcode Cloud build")
        time.sleep(30)


def describe_failed_run(client: AppStoreConnect, build_run_id: str) -> None:
    actions = client.request(
        "GET",
        f"/v1/ciBuildRuns/{build_run_id}/actions?limit=200&"
        "fields[ciBuildActions]=name,actionType,executionProgress,completionStatus,issueCounts",
    )
    for action in actions.get("data", []):
        action_attributes = action.get("attributes") or {}
        print(
            f"- action={action_attributes.get('name')} "
            f"type={action_attributes.get('actionType')} "
            f"progress={action_attributes.get('executionProgress')} "
            f"completion={action_attributes.get('completionStatus')} "
            f"issues={action_attributes.get('issueCounts')}",
            flush=True,
        )
        action_id = action.get("id")
        if not action_id:
            continue
        issue_payload = client.request(
            "GET",
            f"/v1/ciBuildActions/{action_id}/issues?limit=50",
        )
        for issue in issue_payload.get("data") or []:
            issue_attributes = issue.get("attributes") or {}
            print(
                f"  issue type={issue_attributes.get('issueType')} "
                f"category={issue_attributes.get('category')} "
                f"message={issue_attributes.get('message')}",
                flush=True,
            )


def wait_for_app_store_build(
    client: AppStoreConnect,
    build_run_id: str,
    timeout_seconds: int,
) -> dict:
    deadline = time.time() + timeout_seconds
    while True:
        payload = client.request(
            "GET",
            f"/v1/ciBuildRuns/{build_run_id}/builds?limit=50&"
            "fields[builds]=version,processingState,uploadedDate",
        )
        builds = payload.get("data") or []
        if builds:
            build = builds[0]
            attributes = build.get("attributes") or {}
            state = attributes.get("processingState")
            print(
                f"App Store build id={build.get('id')} version={attributes.get('version')} "
                f"processing={state} uploaded={attributes.get('uploadedDate')}",
                flush=True,
            )
            if state == "VALID":
                return build
            if state in {"INVALID", "FAILED"}:
                raise SystemExit(
                    f"App Store Connect rejected build {attributes.get('version')} ({state})."
                )
        else:
            print(
                "App Store Connect has not attached a build to the Xcode Cloud run yet.",
                flush=True,
            )
        if time.time() >= deadline:
            raise SystemExit(
                "Timed out waiting for a VALID App Store Connect build. "
                "Confirm Xcode Cloud shared ASC API secrets so ci_post_xcodebuild can upload the IPA."
            )
        time.sleep(30)


def print_run_outputs(run: dict, store_build: dict | None = None) -> None:
    attributes = run.get("attributes") or {}
    emit("build_run_id", run.get("id"))
    emit("cloud_number", attributes.get("number"))
    emit("source_sha", source_sha(run))
    if store_build:
        store_attributes = store_build.get("attributes") or {}
        emit("app_store_build_id", store_build.get("id"))
        emit("build_number", store_attributes.get("version"))
        emit("processing_state", store_attributes.get("processingState"))


def command_inspect(client: AppStoreConnect) -> None:
    product = client.request("GET", f"/v1/apps/{client.app_id}/ciProduct").get("data")
    if not product:
        raise SystemExit("No Xcode Cloud product found for EdgeEver")
    workflows = client.collect(
        f"/v1/ciProducts/{product['id']}/workflows?"
        + urllib.parse.urlencode(
            {"limit": 50, "fields[ciWorkflows]": "name,isEnabled,lastModifiedDate"}
        )
    )
    print("Available Xcode Cloud workflows:")
    for workflow in workflows:
        attributes = workflow.get("attributes") or {}
        print(
            f"- id={workflow['id']} name={attributes.get('name')} "
            f"enabled={attributes.get('isEnabled')} modified={attributes.get('lastModifiedDate')}"
        )


def command_start(args: argparse.Namespace, client: AppStoreConnect) -> None:
    workflow = select_archive_workflow(client, args.workflow_id)
    workflow_id = workflow["id"]
    emit("workflow_id", workflow_id)
    emit("workflow_name", (workflow.get("attributes") or {}).get("name"))
    git_reference_id = None
    if args.git_ref:
        reference = resolve_git_reference(client, workflow_id, args.git_ref)
        git_reference_id = reference["id"]
        emit(
            "git_ref",
            (reference.get("attributes") or {}).get("canonicalName"),
        )
    run = start_build(client, workflow_id, git_reference_id)
    attributes = run.get("attributes") or {}
    print(
        f"Started Xcode Cloud build id={run['id']} number={attributes.get('number')} "
        f"status={attributes.get('executionProgress')}",
        flush=True,
    )
    emit("build_run_id", run["id"])
    if args.wait or args.wait_valid:
        run = wait_for_cloud_build(
            client,
            run["id"],
            args.require_sha,
            args.timeout_seconds,
        )
        store_build = None
        if args.wait_valid:
            store_build = wait_for_app_store_build(
                client,
                run["id"],
                args.valid_timeout_seconds,
            )
        print_run_outputs(run, store_build)


def command_describe(args: argparse.Namespace, client: AppStoreConnect) -> None:
    run = read_build_run(client, args.build_run_id)
    attributes = run.get("attributes") or {}
    print(
        f"Xcode Cloud build id={run.get('id')} number={attributes.get('number')} "
        f"progress={attributes.get('executionProgress')} "
        f"completion={attributes.get('completionStatus')} "
        f"sha={source_sha(run) or 'pending'}",
        flush=True,
    )
    describe_failed_run(client, args.build_run_id)
    builds = client.request(
        "GET",
        f"/v1/ciBuildRuns/{args.build_run_id}/builds?limit=50&"
        "fields[builds]=version,processingState,uploadedDate",
    ).get("data") or []
    if not builds:
        print("No App Store Connect builds are attached to this Cloud run.", flush=True)
        return
    for build in builds:
        build_attributes = build.get("attributes") or {}
        print(
            f"App Store build id={build.get('id')} version={build_attributes.get('version')} "
            f"processing={build_attributes.get('processingState')} "
            f"uploaded={build_attributes.get('uploadedDate')}",
            flush=True,
        )


def command_wait(args: argparse.Namespace, client: AppStoreConnect) -> None:
    run = wait_for_cloud_build(
        client,
        args.build_run_id,
        args.require_sha,
        args.timeout_seconds,
    )
    store_build = None
    if args.wait_valid:
        store_build = wait_for_app_store_build(
            client,
            args.build_run_id,
            args.valid_timeout_seconds,
        )
    print_run_outputs(run, store_build)


def command_store_status(args: argparse.Namespace, client: AppStoreConnect) -> None:
    if not args.version or not args.build_id:
        raise SystemExit("store-status requires --version and --build-id")
    version_query = urllib.parse.urlencode(
        {
            "filter[platform]": "IOS",
            "filter[versionString]": args.version,
            "fields[appStoreVersions]": "platform,versionString,appStoreState,releaseType,build",
            "include": "build",
            "limit": 10,
        }
    )
    versions = client.request("GET", f"/v1/apps/{client.app_id}/appStoreVersions?{version_query}")
    print(f"App Store version records for {args.version}: {len(versions.get('data', []))}")
    for version in versions.get("data", []):
        attributes = version.get("attributes") or {}
        linked_build = ((version.get("relationships") or {}).get("build") or {}).get("data") or {}
        print(
            f"- version id={version.get('id')} state={attributes.get('appStoreState')} "
            f"releaseType={attributes.get('releaseType')} "
            f"build_id={linked_build.get('id')}"
        )
    build = client.request(
        "GET",
        f"/v1/builds/{args.build_id}?fields[builds]=version,processingState,uploadedDate",
    )["data"]
    attributes = build.get("attributes") or {}
    print(
        f"Requested build id={build.get('id')} version={attributes.get('version')} "
        f"processing={attributes.get('processingState')} "
        f"uploaded={attributes.get('uploadedDate')}"
    )
    linked_build_ids = {
        (((version.get("relationships") or {}).get("build") or {}).get("data") or {}).get("id")
        for version in versions.get("data", [])
    }
    for build_id in sorted((linked_build_ids | {args.build_id}) - {None}):
        prerelease = client.request("GET", f"/v1/builds/{build_id}/preReleaseVersion").get("data") or {}
        print(
            f"- build id={build_id} marketing_version="
            f"{(prerelease.get('attributes') or {}).get('version')}"
        )


def command_cancel_review(args: argparse.Namespace, client: AppStoreConnect) -> None:
    version_query = urllib.parse.urlencode(
        {
            "filter[platform]": "IOS",
            "filter[versionString]": args.version,
            "fields[appStoreVersions]": "versionString,appStoreState,build",
            "include": "build",
            "limit": 10,
        }
    )
    versions = client.request("GET", f"/v1/apps/{client.app_id}/appStoreVersions?{version_query}").get("data") or []
    if len(versions) != 1:
        raise SystemExit(f"Expected exactly one iOS App Store version {args.version}; found {len(versions)}")
    version = versions[0]
    attributes = version.get("attributes") or {}
    linked_build = ((version.get("relationships") or {}).get("build") or {}).get("data") or {}
    if attributes.get("appStoreState") != "WAITING_FOR_REVIEW" or linked_build.get("id") != args.current_build_id:
        raise SystemExit("App Store version state or linked build changed; refusing to cancel review")

    replacement = client.request(
        "GET", f"/v1/builds/{args.replacement_build_id}?fields[builds]=version,processingState"
    ).get("data") or {}
    prerelease = client.request(
        "GET", f"/v1/builds/{args.replacement_build_id}/preReleaseVersion"
    ).get("data") or {}
    if (
        (replacement.get("attributes") or {}).get("processingState") != "VALID"
        or (prerelease.get("attributes") or {}).get("version") != args.version
    ):
        raise SystemExit("Replacement build is not VALID for the requested marketing version")

    review_query = urllib.parse.urlencode(
        {
            "filter[platform]": "IOS",
            "filter[state]": "WAITING_FOR_REVIEW",
            "fields[reviewSubmissions]": "state,appStoreVersionForReview",
            "include": "appStoreVersionForReview",
            "limit": 50,
        }
    )
    submissions = client.request("GET", f"/v1/apps/{client.app_id}/reviewSubmissions?{review_query}").get("data") or []
    matching = [
        submission for submission in submissions
        if (((submission.get("relationships") or {}).get("appStoreVersionForReview") or {}).get("data") or {}).get("id") == version.get("id")
    ]
    if len(matching) != 1:
        raise SystemExit(f"Expected one waiting review submission for {args.version}; found {len(matching)}")
    submission_id = matching[0]["id"]
    items_query = urllib.parse.urlencode(
        {"fields[reviewSubmissionItems]": "state,appStoreVersion", "include": "appStoreVersion", "limit": 50}
    )
    items = client.request("GET", f"/v1/reviewSubmissions/{submission_id}/items?{items_query}").get("data") or []
    item_summary = [
        {
            "id": item.get("id"),
            "state": (item.get("attributes") or {}).get("state"),
            "relationships": {
                name: (relationship.get("data") or {}).get("id")
                for name, relationship in (item.get("relationships") or {}).items()
            },
        }
        for item in items
    ]
    if len(items) != 1 or (
        (((items[0].get("relationships") or {}).get("appStoreVersion") or {}).get("data") or {}).get("id") != version.get("id")
    ):
        raise SystemExit(f"Review submission has unexpected items; refusing to cancel: {item_summary}")

    response = client.request(
        "PATCH",
        f"/v1/reviewSubmissions/{submission_id}",
        {"data": {"type": "reviewSubmissions", "id": submission_id, "attributes": {"canceled": True}}},
    )
    print(
        f"Canceled review submission {submission_id} for {args.version}; "
        f"state={((response.get('data') or {}).get('attributes') or {}).get('state')}"
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("inspect", help="List Xcode Cloud workflows")

    start = sub.add_parser("start", help="Start the Archive workflow")
    start.add_argument("--workflow-id", default="")
    start.add_argument("--git-ref", default="", help="Tag, branch, or refs/* name")
    start.add_argument("--require-sha", default="")
    start.add_argument("--wait", action="store_true")
    start.add_argument("--wait-valid", action="store_true")
    start.add_argument("--timeout-seconds", type=int, default=85 * 60)
    start.add_argument("--valid-timeout-seconds", type=int, default=25 * 60)

    describe = sub.add_parser("describe", help="Dump a Cloud run's actions, issues, and ASC builds")
    describe.add_argument("--build-run-id", required=True)

    wait = sub.add_parser("wait", help="Monitor an existing Xcode Cloud build")
    wait.add_argument("--build-run-id", required=True)
    wait.add_argument("--require-sha", default="")
    wait.add_argument("--wait-valid", action="store_true")
    wait.add_argument("--timeout-seconds", type=int, default=85 * 60)
    wait.add_argument("--valid-timeout-seconds", type=int, default=25 * 60)

    status = sub.add_parser("store-status", help="Inspect an App Store version/build")
    status.add_argument("--version", required=True)
    status.add_argument("--build-id", required=True)

    cancel = sub.add_parser("cancel-review", help="Cancel a mismatched iOS review submission")
    cancel.add_argument("--version", required=True)
    cancel.add_argument("--current-build-id", required=True)
    cancel.add_argument("--replacement-build-id", required=True)
    return parser


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    client = AppStoreConnect()
    if args.command == "inspect":
        command_inspect(client)
        return
    if args.command == "start":
        command_start(args, client)
        return
    if args.command == "describe":
        command_describe(args, client)
        return
    if args.command == "wait":
        command_wait(args, client)
        return
    if args.command == "store-status":
        command_store_status(args, client)
        return
    if args.command == "cancel-review":
        command_cancel_review(args, client)
        return
    raise SystemExit(f"Unsupported command: {args.command}")


if __name__ == "__main__":
    main()
