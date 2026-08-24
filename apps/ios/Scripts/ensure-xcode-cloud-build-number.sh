#!/usr/bin/env bash
# Ensure App Store Connect "Xcode Cloud next build number" is high enough
# before starting a Cloud archive. Cloud overwrites CFBundleVersion with that
# value; if it is lower than the latest ASC build, the IPA cannot be used.
#
# Required env:
#   APP_STORE_CONNECT_API_KEY_ID
#   APP_STORE_CONNECT_API_ISSUER_ID
#   APP_STORE_CONNECT_API_KEY_P8_BASE64  OR  ~/.appstoreconnect/private_keys/AuthKey_<id>.p8
#
# Optional:
#   APP_STORE_CONNECT_APP_ID   (default: 6792625631 EdgeEver)
#   EDGE_EVER_IOS_MIN_BUILD   (override floor; else Config/Version.xcconfig)
#   EDGE_EVER_IOS_APPLY=1     (default) also rewrite Version.xcconfig to recommended next
#
# Usage (from apps/ios):
#   bash Scripts/ensure-xcode-cloud-build-number.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_ID="${APP_STORE_CONNECT_APP_ID:-6792625631}"
KEY_ID="${APP_STORE_CONNECT_API_KEY_ID:?APP_STORE_CONNECT_API_KEY_ID required}"
ISSUER="${APP_STORE_CONNECT_API_ISSUER_ID:?APP_STORE_CONNECT_API_ISSUER_ID required}"
APPLY="${EDGE_EVER_IOS_APPLY:-1}"

KEY_DIR="${HOME}/.appstoreconnect/private_keys"
mkdir -p "$KEY_DIR"
KEY_FILE="${KEY_DIR}/AuthKey_${KEY_ID}.p8"
if [[ ! -f "$KEY_FILE" ]]; then
  P8_B64="${APP_STORE_CONNECT_API_KEY_P8_BASE64:?Need $KEY_FILE or APP_STORE_CONNECT_API_KEY_P8_BASE64}"
  printf '%s' "$P8_B64" | base64 -d >"$KEY_FILE"
  chmod 600 "$KEY_FILE"
fi

FLOOR="${EDGE_EVER_IOS_MIN_BUILD:-}"
if [[ -z "$FLOOR" && -f "$ROOT/Config/Version.xcconfig" ]]; then
  FLOOR="$(sed -nE 's/^CURRENT_PROJECT_VERSION[[:space:]]*=[[:space:]]*([0-9]+).*/\1/p' "$ROOT/Config/Version.xcconfig" | head -1)"
fi
FLOOR="${FLOOR:-1}"

export EDGE_EVER_ASC_KEY_ID="$KEY_ID"
export EDGE_EVER_ASC_ISSUER="$ISSUER"
export EDGE_EVER_ASC_KEY_FILE="$KEY_FILE"
export EDGE_EVER_ASC_APP_ID="$APP_ID"
export EDGE_EVER_ASC_FLOOR="$FLOOR"
export EDGE_EVER_ASC_APPLY="$APPLY"
export EDGE_EVER_IOS_ROOT="$ROOT"

python3 <<'PY'
import json, os, pathlib, re, sys, time, urllib.request, urllib.error

def ensure_jwt():
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

jwt = ensure_jwt()
key_id = os.environ["EDGE_EVER_ASC_KEY_ID"]
issuer = os.environ["EDGE_EVER_ASC_ISSUER"]
key_file = pathlib.Path(os.environ["EDGE_EVER_ASC_KEY_FILE"])
app_id = os.environ["EDGE_EVER_ASC_APP_ID"]
floor = int(os.environ["EDGE_EVER_ASC_FLOOR"])
apply = os.environ.get("EDGE_EVER_ASC_APPLY", "1") == "1"
ios_root = pathlib.Path(os.environ["EDGE_EVER_IOS_ROOT"])

private_key = key_file.read_text()
now = int(time.time())
token = jwt.encode(
    {"iss": issuer, "iat": now, "exp": now + 20 * 60, "aud": "appstoreconnect-v1"},
    private_key,
    algorithm="ES256",
    headers={"kid": key_id, "typ": "JWT"},
)
if isinstance(token, bytes):
    token = token.decode()


def api(method, path, body=None):
    url = "https://api.appstoreconnect.apple.com" + path
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        try:
            err = json.loads(err)
        except Exception:
            pass
        raise SystemExit(f"API {method} {path} -> {e.code}: {err}")


st, builds = api(
    "GET",
    f"/v1/builds?filter[app]={app_id}&sort=-uploadedDate&limit=30&fields[builds]=version,processingState",
)
latest = 0
for d in builds.get("data", []):
    try:
        latest = max(latest, int(str(d["attributes"]["version"])))
    except (KeyError, TypeError, ValueError):
        pass

desired = max(floor, latest + 1)
print(f"latest_asc_build={latest}")
print(f"local_floor={floor}")
print(f"recommended_next_cloud_build={desired}")
print(
    "Set App Store Connect → EdgeEver → Xcode Cloud → Settings → Build Number → "
    f"next = {desired} (or higher) before Start Build."
)

# Best-effort: read the ciProduct for this app (manual UI remains source of truth for next number)
st, product = api("GET", f"/v1/apps/{app_id}/ciProduct")
if isinstance(product, dict):
    p = product.get("data") or {}
    attrs = p.get("attributes") or {}
    print(f"ciProduct id={p.get('id')} name={attrs.get('name')} productType={attrs.get('productType')}")

if apply:
    version_file = ios_root / "Config" / "Version.xcconfig"
    if version_file.is_file():
        text = version_file.read_text()
        new_text, n = re.subn(
            r"^(CURRENT_PROJECT_VERSION\s*=\s*)\d+",
            rf"\g<1>{desired}",
            text,
            count=1,
            flags=re.M,
        )
        if n and new_text != text:
            version_file.write_text(new_text)
            print(f"Updated {version_file} CURRENT_PROJECT_VERSION={desired}")
        else:
            print(f"Version.xcconfig already at CURRENT_PROJECT_VERSION>={desired} or unchanged")
    yml = ios_root / "project.yml"
    if yml.is_file():
        ytext = yml.read_text()
        ynew, yn = re.subn(
            r"(CURRENT_PROJECT_VERSION:\s*)\d+",
            rf"\g<1>{desired}",
            ytext,
            count=1,
        )
        if yn and ynew != ytext:
            yml.write_text(ynew)
            print(f"Updated {yml} CURRENT_PROJECT_VERSION={desired}")

print("OK")
print(f"NEXT_BUILD={desired}")
PY
