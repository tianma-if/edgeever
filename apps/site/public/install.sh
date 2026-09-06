#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

readonly GHCR_IMAGE="ghcr.io/tianma-if/edgeever"
readonly TCR_IMAGE="ccr.ccs.tencentyun.com/edgeever/edgeever"
readonly GLOBAL_COMPOSE_URL="https://edgeever.org/compose.yaml"
readonly TENCENT_COMPOSE_URL="https://edgeever-installer-1256854452.cos.ap-guangzhou.myqcloud.com/compose.yaml"

install_dir="${EDGE_EVER_INSTALL_DIR:-${HOME:-}/edgeever}"
compose_url="${EDGE_EVER_COMPOSE_URL:-}"
image="${EDGE_EVER_IMAGE:-}"
version="${EDGE_EVER_VERSION:-}"
port="${EDGE_EVER_PORT:-}"
username="${EDGE_EVER_AUTH_USERNAME:-}"
password="${EDGE_EVER_AUTH_PASSWORD:-}"
project_name="${EDGE_EVER_PROJECT_NAME:-edgeever}"
auto_update="${EDGE_EVER_AUTO_UPDATE:-true}"
generated_password=false
temporary_compose=""
temporary_env=""
temporary_update=""
temporary_crontab=""
current_step="Parse arguments"
diagnostics_printed=false
start_epoch=0
auto_update_status="disabled"
declare -a compose=()

log() {
  local level="$1"
  shift
  printf '[%s] [%-7s] %s\n' "$(date '+%H:%M:%S')" "$level" "$*" >&2
}

step() {
  current_step="$2"
  log "STEP $1/6" "$2"
}

print_storage_diagnostics() {
  local container_id container_user mount_info mount_type mount_name mount_source probe_output
  container_id="$("${compose[@]}" ps -q edgeever 2>/dev/null || true)"
  container_user=""
  mount_info=""

  if [[ -n "$container_id" ]]; then
    container_user="$(docker inspect --format '{{.Config.User}}' "$container_id" 2>/dev/null || true)"
    mount_info="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Type}}|{{.Name}}|{{.Source}}{{end}}{{end}}' "$container_id" 2>/dev/null || true)"
  fi

  log INFO "Persistent storage diagnostics:"
  log INFO "Container user: ${container_user:-unknown} (EdgeEver expects UID/GID 1000:1000)"
  if [[ -n "$mount_info" ]]; then
    IFS='|' read -r mount_type mount_name mount_source <<< "$mount_info"
    log INFO "/data mount: type=${mount_type:-unknown}, source=${mount_source:-unknown}${mount_name:+, volume=$mount_name}"
  else
    mount_type=""
    mount_name=""
    mount_source=""
    log WARN "Could not identify the /data mount; inspect it with: docker inspect $container_id"
  fi

  if probe_output="$("${compose[@]}" run --rm --no-deps --entrypoint /bin/sh edgeever -c '
probe="/data/.edgeever-write-test-$$"
if (umask 077 && : > "$probe" && rm -f "$probe"); then
  exit 0
fi
printf "EDGEEVER_DATA_WRITE_FAILED\n" >&2
printf "Runtime identity: " >&2
id >&2 || true
printf "Data directory: " >&2
ls -ldn /data >&2 || true
exit 73
' 2>&1)"; then
    log INFO "/data write test: passed"
    return 0
  fi

  if [[ "$probe_output" != *"EDGEEVER_DATA_WRITE_FAILED"* ]]; then
    log WARN "/data write test: unavailable (the diagnostic container could not run)"
    [[ -z "$probe_output" ]] || printf '%s\n' "$probe_output" | sed 's/^/  /' >&2
    return 0
  fi

  log ERROR "/data write test: failed"
  printf '%s\n' "$probe_output" | sed '/^EDGEEVER_DATA_WRITE_FAILED$/d; s/^/  /' >&2
  if [[ "$mount_type" == "bind" && -n "$mount_source" ]]; then
    log INFO "The NAS/host directory must be writable by UID/GID 1000:1000. Suggested repair:"
    printf '  sudo chown -R 1000:1000 -- %q\n' "$mount_source" >&2
    printf '  sudo chmod -R u+rwX -- %q\n' "$mount_source" >&2
    log INFO "If the NAS uses ACL permissions, grant UID 1000 read/write access in its control panel too."
  elif [[ "$mount_type" == "volume" ]]; then
    log INFO "The Docker volume must be writable by UID/GID 1000:1000. Suggested repair:"
    printf '  cd %q\n' "$install_dir" >&2
    printf "  docker compose --project-name %q run --rm --no-deps --user 0 --entrypoint /bin/sh edgeever -c 'chown -R 1000:1000 /data'\n" "$project_name" >&2
  else
    log INFO "Check the Compose /data mount and grant UID/GID 1000:1000 read/write access."
    printf '  cd %q\n' "$install_dir" >&2
    printf '  docker compose --project-name %q config\n' "$project_name" >&2
  fi
}

usage() {
  cat <<'EOF'
Install or upgrade EdgeEver with Docker Compose.

Usage:
  curl -fsSL https://edgeever.org/install.sh | bash

Options:
  --image IMAGE      Use a custom image repository
  --version TAG      Deploy an image tag (default: latest)
  --compose-url URL  Download Compose configuration from URL
  --install-dir DIR  Store Compose configuration in DIR (default: ~/edgeever)
  --port PORT        Publish EdgeEver on PORT (default: 8787)
  --auto-update      Enable daily automatic updates (default)
  --no-auto-update   Disable daily automatic updates
  -h, --help         Show this help

The same options can be provided with EDGE_EVER_IMAGE, EDGE_EVER_VERSION,
EDGE_EVER_COMPOSE_URL, EDGE_EVER_INSTALL_DIR, EDGE_EVER_PORT, and
EDGE_EVER_AUTH_PASSWORD. Set EDGE_EVER_AUTO_UPDATE=false to disable automatic
updates.
EOF
}

print_diagnostics() {
  [[ "$diagnostics_printed" == false ]] || return 0
  diagnostics_printed=true

  log ERROR "Stage: $current_step"
  if ((${#compose[@]} > 0)); then
    log INFO "Container status:"
    "${compose[@]}" ps -a >&2 || true
    log INFO "Recent container logs:"
    "${compose[@]}" logs --tail 80 edgeever >&2 || true
    print_storage_diagnostics || true
    log INFO "Troubleshooting commands:"
    printf '  cd %q\n' "$install_dir" >&2
    printf '  docker compose --project-name %q --env-file .env --file compose.yaml ps -a\n' "$project_name" >&2
    printf '  docker compose --project-name %q --env-file .env --file compose.yaml logs --tail 200 edgeever\n' "$project_name" >&2
  fi
  log INFO "Deployment guide: https://github.com/tianma-if/edgeever/blob/main/docs/deploy-docker.md"
}

fail() {
  trap - ERR
  log ERROR "$*"
  print_diagnostics
  exit 1
}

on_error() {
  local exit_code=$?
  local line_number="${BASH_LINENO[0]}"
  trap - ERR
  log ERROR "A command failed (exit code: $exit_code, line: $line_number)"
  print_diagnostics
  exit "$exit_code"
}

trap on_error ERR

require_value() {
  [[ $# -ge 2 && -n "$2" ]] || fail "$1 requires a value"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mirror)
      require_value "$@"
      case "$2" in
        ghcr) image="$GHCR_IMAGE" ;;
        tcr) image="$TCR_IMAGE" ;;
        *) fail "--mirror must be ghcr or tcr" ;;
      esac
      shift 2
      ;;
    --image)
      require_value "$@"
      image="$2"
      shift 2
      ;;
    --version)
      require_value "$@"
      version="$2"
      shift 2
      ;;
    --compose-url)
      require_value "$@"
      compose_url="$2"
      shift 2
      ;;
    --install-dir)
      require_value "$@"
      install_dir="$2"
      shift 2
      ;;
    --port)
      require_value "$@"
      port="$2"
      shift 2
      ;;
    --auto-update)
      auto_update=true
      shift
      ;;
    --no-auto-update)
      auto_update=false
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *) fail "unknown option: $1" ;;
  esac
done

start_epoch="$(date '+%s')"
step 1 "Validate environment"
[[ -n "$install_dir" ]] || fail "set HOME or EDGE_EVER_INSTALL_DIR"
[[ "$project_name" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail "invalid EDGE_EVER_PROJECT_NAME"

command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v docker >/dev/null 2>&1 || fail "Docker is required: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required"
docker info >/dev/null 2>&1 || fail "cannot connect to the Docker daemon"
log INFO "Docker and Docker Compose are available"

host_os=""
if [[ -r /etc/os-release ]]; then
  while IFS='=' read -r key value; do
    if [[ "$key" == "PRETTY_NAME" ]]; then
      host_os="${value#\"}"
      host_os="${host_os%\"}"
      break
    fi
  done < /etc/os-release
fi
host_os="${host_os:-$(uname -s)}"
kernel_version="$(uname -sr)"
host_architecture="$(uname -m)"
docker_engine_version="$(docker version --format '{{.Server.Version}}' 2>/dev/null || true)"
docker_engine_version="${docker_engine_version:-unknown}"
docker_compose_version="$(docker compose version --short 2>/dev/null || true)"
docker_compose_version="${docker_compose_version:-unknown}"
log INFO "Host OS: $host_os"
log INFO "Kernel: $kernel_version"
log INFO "Architecture: $host_architecture"
log INFO "Docker Engine: $docker_engine_version"
log INFO "Docker Compose: $docker_compose_version"

mkdir -p "$install_dir"
env_file="$install_dir/.env"
compose_file="$install_dir/compose.yaml"
if [[ -f "$env_file" ]]; then
  install_mode="upgrade"
else
  install_mode="new installation"
fi

read_env_value() {
  local key="$1"
  local line value
  [[ -f "$env_file" ]] || return 1
  while IFS= read -r line; do
    case "$line" in
      "$key="*)
        value="${line#*=}"
        if [[ "$value" == "'"*"'" && ${#value} -ge 2 ]]; then
          value="${value:1:${#value}-2}"
        fi
        printf '%s' "$value"
        return 0
        ;;
    esac
  done < "$env_file"
  return 1
}

step 2 "Resolve configuration"
if [[ -z "$image" ]]; then
  image="$(read_env_value EDGE_EVER_IMAGE || true)"
  image="${image:-$GHCR_IMAGE}"
fi

if [[ -z "$compose_url" ]]; then
  if [[ "$image" == "$TCR_IMAGE" ]]; then
    compose_url="$TENCENT_COMPOSE_URL"
  else
    compose_url="$GLOBAL_COMPOSE_URL"
  fi
fi

if [[ -z "$version" ]]; then
  version="$(read_env_value EDGE_EVER_VERSION || true)"
  version="${version:-latest}"
fi

if [[ -z "$port" ]]; then
  port="$(read_env_value EDGE_EVER_PORT || true)"
  port="${port:-8787}"
fi

if [[ -z "$username" ]]; then
  username="$(read_env_value EDGE_EVER_AUTH_USERNAME || true)"
  username="${username:-admin}"
fi

if [[ -z "$password" ]]; then
  password="$(read_env_value EDGE_EVER_AUTH_PASSWORD || true)"
fi

if [[ -z "$password" ]]; then
  if command -v openssl >/dev/null 2>&1; then
    password="$(openssl rand -hex 16)"
  elif command -v od >/dev/null 2>&1; then
    password="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
  else
    fail "openssl or od is required to generate a password"
  fi
  generated_password=true
fi

[[ "$image" != *[[:space:]]* ]] || fail "image must not contain whitespace"
[[ "$version" != *[[:space:]]* ]] || fail "version must not contain whitespace"
[[ "$port" =~ ^[0-9]+$ ]] && ((port >= 1 && port <= 65535)) || fail "port must be between 1 and 65535"
[[ "$username" != *$'\n'* && "$username" != *"'"* ]] || fail "invalid administrator username"
[[ "$password" != *$'\n'* && "$password" != *"'"* ]] || fail "password must not contain a newline or single quote"
[[ "$auto_update" == "true" || "$auto_update" == "false" ]] || fail "EDGE_EVER_AUTO_UPDATE must be true or false"
log INFO "Mode: $install_mode"
log INFO "Install directory: $install_dir"
log INFO "EdgeEver target: $image:$version"
log INFO "Compose source: $compose_url"
log INFO "Published port: $port"
log INFO "Daily automatic updates: $auto_update"

cleanup() {
  [[ -z "$temporary_compose" || ! -e "$temporary_compose" ]] || rm -f "$temporary_compose"
  [[ -z "$temporary_env" || ! -e "$temporary_env" ]] || rm -f "$temporary_env"
  [[ -z "$temporary_update" || ! -e "$temporary_update" ]] || rm -f "$temporary_update"
  [[ -z "$temporary_crontab" || ! -e "$temporary_crontab" ]] || rm -f "$temporary_crontab"
  return 0
}
trap cleanup EXIT

step 3 "Download Compose configuration"
temporary_compose="$(mktemp "$install_dir/.compose.yaml.XXXXXX")"
curl --fail --silent --show-error --location --output "$temporary_compose" "$compose_url"
grep -q '^services:' "$temporary_compose" || fail "downloaded Compose file is invalid"
chmod 0644 "$temporary_compose"
mv "$temporary_compose" "$compose_file"
temporary_compose=""
log INFO "Saved Compose configuration to $compose_file"

step 4 "Write runtime configuration"
temporary_env="$(mktemp "$install_dir/.env.XXXXXX")"
{
  printf "EDGE_EVER_IMAGE='%s'\n" "$image"
  printf "EDGE_EVER_VERSION='%s'\n" "$version"
  printf "EDGE_EVER_PORT='%s'\n" "$port"
  printf "EDGE_EVER_AUTH_USERNAME='%s'\n" "$username"
  printf "EDGE_EVER_AUTH_PASSWORD='%s'\n" "$password"
} > "$temporary_env"
chmod 0600 "$temporary_env"
mv "$temporary_env" "$env_file"
temporary_env=""
log INFO "Saved protected configuration to $env_file (password hidden)"

compose=(
  docker compose
  --project-name "$project_name"
  --project-directory "$install_dir"
  --env-file "$env_file"
  --file "$compose_file"
)

write_auto_update_script() {
  local update_script="$install_dir/update.sh"
  local docker_command curl_command
  docker_command="$(command -v docker)"
  curl_command="$(command -v curl)"
  temporary_update="$(mktemp "$install_dir/.update.sh.XXXXXX")"

  {
    printf '#!/usr/bin/env bash\n\n'
    printf 'set -Eeuo pipefail\n'
    printf 'umask 077\n\n'
    printf 'readonly docker_command=%q\n' "$docker_command"
    printf 'readonly curl_command=%q\n' "$curl_command"
    printf 'readonly install_dir=%q\n' "$install_dir"
    printf 'readonly compose_url=%q\n' "$compose_url"
    printf 'readonly project_name=%q\n\n' "$project_name"
    cat <<'EOF'
env_file="$install_dir/.env"
compose_file="$install_dir/compose.yaml"
lock_file="$install_dir/.update.lock"
temporary_compose=""

log() {
  printf '[%s] [EdgeEver update] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

print_storage_diagnostics() {
  local container_id container_user mount_info mount_type mount_name mount_source probe_output
  container_id="$("${compose[@]}" ps -q edgeever 2>/dev/null || true)"
  container_user=""
  mount_info=""

  if [[ -n "$container_id" ]]; then
    container_user="$("$docker_command" inspect --format '{{.Config.User}}' "$container_id" 2>/dev/null || true)"
    mount_info="$("$docker_command" inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Type}}|{{.Name}}|{{.Source}}{{end}}{{end}}' "$container_id" 2>/dev/null || true)"
  fi

  log "Persistent storage diagnostics:"
  log "Container user: ${container_user:-unknown} (EdgeEver expects UID/GID 1000:1000)."
  if [[ -n "$mount_info" ]]; then
    IFS='|' read -r mount_type mount_name mount_source <<< "$mount_info"
    log "/data mount: type=${mount_type:-unknown}, source=${mount_source:-unknown}${mount_name:+, volume=$mount_name}."
  else
    mount_type=""
    mount_name=""
    mount_source=""
    log "Could not identify the /data mount."
  fi

  if probe_output="$("${compose[@]}" run --rm --no-deps --entrypoint /bin/sh edgeever -c '
probe="/data/.edgeever-write-test-$$"
if (umask 077 && : > "$probe" && rm -f "$probe"); then
  exit 0
fi
printf "EDGEEVER_DATA_WRITE_FAILED\n" >&2
printf "Runtime identity: " >&2
id >&2 || true
printf "Data directory: " >&2
ls -ldn /data >&2 || true
exit 73
' 2>&1)"; then
    log "/data write test: passed."
    return 0
  fi

  if [[ "$probe_output" != *"EDGEEVER_DATA_WRITE_FAILED"* ]]; then
    log "/data write test: unavailable (the diagnostic container could not run)."
    [[ -z "$probe_output" ]] || printf '%s\n' "$probe_output" | sed 's/^/  /'
    return 0
  fi

  log "/data write test: failed."
  printf '%s\n' "$probe_output" | sed '/^EDGEEVER_DATA_WRITE_FAILED$/d; s/^/  /'
  if [[ "$mount_type" == "bind" && -n "$mount_source" ]]; then
    log "Grant the NAS/host directory to UID/GID 1000:1000:"
    printf '  sudo chown -R 1000:1000 -- %q\n' "$mount_source"
    printf '  sudo chmod -R u+rwX -- %q\n' "$mount_source"
    log "For NAS ACLs, also grant UID 1000 read/write access in the control panel."
  elif [[ "$mount_type" == "volume" ]]; then
    log "Repair the Docker volume ownership:"
    printf '  cd %q\n' "$install_dir"
    printf "  %q compose --project-name %q run --rm --no-deps --user 0 --entrypoint /bin/sh edgeever -c 'chown -R 1000:1000 /data'\n" "$docker_command" "$project_name"
  else
    log "Inspect the Compose /data mount and grant UID/GID 1000:1000 read/write access."
  fi
}

on_error() {
  local exit_code=$?
  local line_number="${BASH_LINENO[0]}"
  trap - ERR
  log "Update command failed (exit code: $exit_code, line: $line_number)."
  if declare -p compose >/dev/null 2>&1; then
    "${compose[@]}" ps -a || true
    "${compose[@]}" logs --tail 80 edgeever || true
    print_storage_diagnostics || true
  fi
  exit "$exit_code"
}

cleanup() {
  [[ -z "$temporary_compose" || ! -e "$temporary_compose" ]] || rm -f "$temporary_compose"
}
trap on_error ERR
trap cleanup EXIT

if command -v flock >/dev/null 2>&1; then
  exec 9>"$lock_file"
  if ! flock -n 9; then
    log "Another update is already running; skipping."
    exit 0
  fi
fi

compose=(
  "$docker_command" compose
  --project-name "$project_name"
  --project-directory "$install_dir"
  --env-file "$env_file"
  --file "$compose_file"
)

log "Checking for updates."
temporary_compose="$(mktemp "$install_dir/.compose.yaml.XXXXXX")"
"$curl_command" --fail --silent --show-error --location --output "$temporary_compose" "$compose_url"
grep -q '^services:' "$temporary_compose"
chmod 0644 "$temporary_compose"
mv "$temporary_compose" "$compose_file"
temporary_compose=""

"${compose[@]}" pull
"${compose[@]}" up -d --remove-orphans

container_id=""
health=""
for _ in {1..60}; do
  container_id="$("${compose[@]}" ps -q edgeever 2>/dev/null || true)"
  if [[ -n "$container_id" ]]; then
    health="$("$docker_command" inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
    [[ "$health" == "healthy" ]] && break
    [[ "$health" == "exited" || "$health" == "dead" ]] && break
  fi
  sleep 2
done

if [[ "$health" != "healthy" ]]; then
  "${compose[@]}" ps -a || true
  "${compose[@]}" logs --tail 80 edgeever || true
  log "Update failed: container health is ${health:-unknown}."
  exit 1
fi

running_image="$("$docker_command" inspect --format '{{.Config.Image}}' "$container_id" 2>/dev/null || true)"
log "Update complete. Running image: ${running_image:-unknown}."
EOF
  } > "$temporary_update"

  chmod 0700 "$temporary_update"
  mv "$temporary_update" "$update_script"
  temporary_update=""
}

remove_auto_update_schedule() {
  local marker="# edgeever-auto-update:$project_name"
  local existing_line
  command -v crontab >/dev/null 2>&1 || return 0
  temporary_crontab="$(mktemp "$install_dir/.crontab.XXXXXX")"
  while IFS= read -r existing_line; do
    [[ "$existing_line" == *"$marker"* ]] || printf '%s\n' "$existing_line" >> "$temporary_crontab"
  done < <(crontab -l 2>/dev/null || true)
  if ! crontab "$temporary_crontab"; then
    log WARN "Could not update the current user's crontab"
  fi
  rm -f "$temporary_crontab"
  temporary_crontab=""
}

configure_auto_updates() {
  local update_script="$install_dir/update.sh"
  local update_log="$install_dir/update.log"
  local marker="# edgeever-auto-update:$project_name"
  local quoted_script quoted_log

  if [[ "$auto_update" == "false" ]]; then
    remove_auto_update_schedule
    rm -f "$update_script"
    auto_update_status="disabled"
    log INFO "Daily automatic updates are disabled"
    return 0
  fi

  write_auto_update_script
  if ! command -v crontab >/dev/null 2>&1; then
    auto_update_status="updater created at $update_script; cron is unavailable"
    log WARN "crontab is unavailable; schedule $update_script with the NAS task scheduler"
    return 0
  fi

  remove_auto_update_schedule
  temporary_crontab="$(mktemp "$install_dir/.crontab.XXXXXX")"
  crontab -l 2>/dev/null > "$temporary_crontab" || true
  printf -v quoted_script '%q' "$update_script"
  printf -v quoted_log '%q' "$update_log"
  printf '17 4 * * * %s >> %s 2>&1 %s\n' "$quoted_script" "$quoted_log" "$marker" >> "$temporary_crontab"
  if crontab "$temporary_crontab"; then
    auto_update_status="daily at 04:17 server time; log: $update_log"
    log INFO "Scheduled daily automatic updates at 04:17 server time"
  else
    auto_update_status="updater created at $update_script; cron installation failed"
    log WARN "Could not install the cron schedule; run $update_script manually"
  fi
  rm -f "$temporary_crontab"
  temporary_crontab=""
}

step 5 "Pull image and start container"
"${compose[@]}" pull
"${compose[@]}" up -d --remove-orphans

step 6 "Wait for health check"
container_id=""
health=""
for attempt in {1..60}; do
  container_id="$("${compose[@]}" ps -q edgeever 2>/dev/null || true)"
  if [[ -n "$container_id" ]]; then
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
    [[ "$health" == "healthy" ]] && break
    [[ "$health" == "exited" || "$health" == "dead" ]] && break
  fi
  if ((attempt == 1 || attempt % 5 == 0)); then
    log INFO "Waiting for container health (status: ${health:-not started}, elapsed: $((attempt * 2))s)"
  fi
  sleep 2
done

if [[ "$health" != "healthy" ]]; then
  fail "container did not become healthy (status: ${health:-unknown})"
fi

configure_auto_updates
running_image="$(docker inspect --format '{{.Config.Image}}' "$container_id" 2>/dev/null || true)"
log INFO "Running image: ${running_image:-$image:$version}"
log SUCCESS "EdgeEver is ready ($(($(date '+%s') - start_epoch))s)"
printf '\nConnection details\n'
printf '  URL: http://<server-ip>:%s\n' "$port"
printf '  Username: %s\n' "$username"
if [[ "$generated_password" == true ]]; then
  printf '  Password: %s\n' "$password"
else
  printf '  Password: unchanged (stored in %s)\n' "$env_file"
fi
printf '  Install directory: %s\n' "$install_dir"
printf '  Automatic updates: %s\n' "$auto_update_status"
printf '\nUseful commands\n'
printf '  cd %q\n' "$install_dir"
printf '  docker compose ps\n'
printf '  docker compose logs --tail 200 -f edgeever\n'
if [[ "$auto_update" == "true" ]]; then
  printf '  ./update.sh\n'
fi
