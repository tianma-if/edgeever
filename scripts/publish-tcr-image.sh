#!/usr/bin/env bash

set -Eeuo pipefail

readonly TCR_REGISTRY="ccr.ccs.tencentyun.com"
readonly TCR_IMAGE="${TCR_REGISTRY}/edgeever/edgeever"

require_value() {
  local name="$1"
  local value="${!name:-}"
  [[ -n "${value}" ]] || {
    echo "${name} is required" >&2
    exit 1
  }
}

for name in CNB_COMMIT CNB_BRANCH CNB_EVENT TCR_USERNAME TCR_PASSWORD; do
  require_value "${name}"
done

[[ "${CNB_COMMIT}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "CNB_COMMIT must be a full Git SHA" >&2
  exit 1
}
test "$(git rev-parse HEAD)" = "${CNB_COMMIT}"

short_sha="${CNB_COMMIT:0:12}"
if [[ "${CNB_EVENT}" == "push" && "${CNB_BRANCH}" == "main" ]]; then
  version="main"
  primary_tag="sha-${short_sha}"
  promotion_tags=(main)
elif [[ "${CNB_EVENT}" == "tag_push" && "${CNB_BRANCH}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  version="${CNB_BRANCH#v}"
  test "$(jq -r '.version' package.json)" = "${version}"
  primary_tag="${CNB_BRANCH}"
  promotion_tags=("${version}" latest)
else
  echo "Refusing unsupported CNB event ${CNB_EVENT}:${CNB_BRANCH}" >&2
  exit 1
fi

printf '%s' "${TCR_PASSWORD}" | docker login \
  --username "${TCR_USERNAME}" \
  --password-stdin \
  "${TCR_REGISTRY}"

trap 'docker logout "${TCR_REGISTRY}" >/dev/null 2>&1 || true' EXIT

readonly build_attempts=3
for ((attempt = 1; attempt <= build_attempts; attempt += 1)); do
  echo "Building multi-platform TCR image (attempt ${attempt}/${build_attempts})..."
  if timeout --signal=TERM --kill-after=1m 15m docker buildx build \
    --platform linux/amd64,linux/arm64 \
    --tag "${TCR_IMAGE}:${primary_tag}" \
    --label "org.opencontainers.image.source=https://github.com/tianma-if/edgeever" \
    --label "org.opencontainers.image.revision=${CNB_COMMIT}" \
    --label "org.opencontainers.image.version=${version}" \
    --cache-from "type=registry,ref=${TCR_IMAGE}:buildcache" \
    --cache-to "type=registry,ref=${TCR_IMAGE}:buildcache,mode=max,image-manifest=true,oci-mediatypes=true" \
    --push \
    .; then
    break
  fi

  if ((attempt == build_attempts)); then
    echo "TCR image build failed after ${build_attempts} attempts." >&2
    exit 1
  fi

  echo "Build failed; retrying after a short backoff so BuildKit can reuse completed layers." >&2
  sleep $((attempt * 10))
done

primary_inspect="$(docker buildx imagetools inspect "${TCR_IMAGE}:${primary_tag}")"
primary_digest="$(sed -n 's/^Digest:[[:space:]]*//p' <<<"${primary_inspect}" | head -n 1)"
test -n "${primary_digest}"
docker buildx imagetools inspect --raw "${TCR_IMAGE}:${primary_tag}" |
  jq -e '([.manifests[].platform.architecture] | index("amd64") != null) and ([.manifests[].platform.architecture] | index("arm64") != null)'

for image_tag in "${promotion_tags[@]}"; do
  docker buildx imagetools create \
    --tag "${TCR_IMAGE}:${image_tag}" \
    "${TCR_IMAGE}@${primary_digest}"
done

docker logout "${TCR_REGISTRY}"
for image_tag in "${primary_tag}" "${promotion_tags[@]}"; do
  mirror_inspect="$(docker buildx imagetools inspect "${TCR_IMAGE}:${image_tag}")"
  mirror_digest="$(sed -n 's/^Digest:[[:space:]]*//p' <<<"${mirror_inspect}" | head -n 1)"
  test "${primary_digest}" = "${mirror_digest}"
  docker buildx imagetools inspect --raw "${TCR_IMAGE}:${image_tag}" |
    jq -e '([.manifests[].platform.architecture] | index("amd64") != null) and ([.manifests[].platform.architecture] | index("arm64") != null)'
  image_metadata="$(docker buildx imagetools inspect "${TCR_IMAGE}:${image_tag}" --format '{{json .Image}}')"
  jq -e \
    --arg revision "${CNB_COMMIT}" \
    --arg version "${version}" \
    'length >= 2 and all(.[]; .config.Labels["org.opencontainers.image.revision"] == $revision and .config.Labels["org.opencontainers.image.version"] == $version)' \
    <<<"${image_metadata}"
done

if [[ "${CNB_EVENT}" == "push" ]] && [[ -n "${TENCENTCLOUD_SECRET_ID:-}" ]] && [[ -n "${TENCENTCLOUD_SECRET_KEY:-}" ]]; then
  docker run --rm \
    --env TENCENTCLOUD_SECRET_ID \
    --env TENCENTCLOUD_SECRET_KEY \
    --env TENCENTCLOUD_REGION="${TENCENTCLOUD_REGION:-ap-guangzhou}" \
    --env TCR_REPOSITORY=edgeever/edgeever \
    --env TCR_SHA_TAGS_TO_KEEP=20 \
    --volume "${PWD}:/workspace" \
    --workdir /workspace \
    oven/bun:1.3.14-alpine \
    bun scripts/prune-tcr-sha-tags.mjs
else
  echo "Skipping sha-* retention until the tag-specific TCR API credential is configured."
fi
