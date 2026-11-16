// Shared ImgBed protocol. Network and host policy belong to the runtime adapter.
export const createImgBedClient = ({ assertHostShape, assertImageHostAllowed, postImageHostJson, lookup }) => {
  // Stable markers for the settings page; the readable text after each is for logs.
  const TOKEN_REJECTED = "IMGBED_TOKEN_REJECTED: ImgBed rejected the API token";
  // Settings pages from before IMGBED_CHANNELS_UNSUPPORTED only know IMGBED_CHANNEL_NAME,
  // and a desktop app may load a web build of another version, so send both.
  const CHANNELS_UNSUPPORTED = "IMGBED_CHANNELS_UNSUPPORTED: IMGBED_CHANNEL_NAME: this ImgBed version does not support channel names";
  const ADDRESS_ERROR = "Use a CloudFlare ImgBed address such as https://img.example.com";
  const LABEL = "ImgBed";
  const IMGBED_NAME_TYPES = ["default", "index", "origin", "short"];
  // Defaults follow the ImgBed upload API: telegram channel with server compression on.
  const IMGBED_UPLOAD_CHANNELS = ["telegram", "cfr2", "s3", "discord", "huggingface", "webdav"];
  // Optional name of one channel inside the selected type (ImgBed's channelName).
  const IMGBED_MAX_CHANNEL_NAME_LENGTH = 100;
  const IMGBED_MAX_IMAGE_BYTES = 50 * 1024 * 1024;
  // 1×1 transparent PNG used by the connection test.
  const TEST_IMAGE = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

  // Accepts the site root or a full .../upload address and returns the upload URL.
  const normalizeImgBedEndpoint = (value) => {
    let url;
    try { url = new URL(String(value ?? "").trim()); }
    catch { throw new Error(ADDRESS_ERROR); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || url.search) {
      throw new Error(ADDRESS_ERROR);
    }
    assertHostShape(url.hostname, ADDRESS_ERROR);
    const base = url.pathname.replace(/\/+$/, "").replace(/\/upload$/, "");
    url.pathname = `${base}/upload`;
    return url;
  };

  const normalizeImgBedToken = (value) => {
    if (typeof value !== "string") throw new Error("ImgBed API token is invalid");
    const token = value.trim();
    // oxlint-disable-next-line no-control-regex -- rejects control characters and spaces in the ImgBed token
    if (!token || token.length > 1024 || /[\u0000- \u007f]/.test(token)) throw new Error("ImgBed API token is invalid");
    return token;
  };

  // The folder arrives already expanded. Keep it a plain relative path.
  const normalizeImgBedFolder = (value) => {
    if (value == null || value === "") return "";
    if (typeof value !== "string" || value.length > 200) throw new Error("ImgBed upload folder is invalid");
    // oxlint-disable-next-line no-control-regex -- rejects control characters in the ImgBed upload folder
    if (/[\u0000-\u001f\u007f\\?#%<>:*|"{}]/.test(value)) throw new Error("ImgBed upload folder is invalid");
    const segments = value.split("/").map((segment) => segment.trim()).filter(Boolean);
    if (segments.some((segment) => segment === "." || segment === "..")) throw new Error("ImgBed upload folder is invalid");
    return segments.join("/");
  };

  // ImgBed matches the name exactly and silently falls back to the type's first
  // (or load-balanced) channel when nothing matches, so only trim the edges.
  // Same rule as isImgBedChannelNameValid in the renderer: control characters
  // anywhere are rejected before trimming, and the limit applies to the trimmed name.
  // oxlint-disable-next-line no-control-regex -- rejects control characters in the ImgBed channel name
  const isImgBedChannelNameValid = (value) => typeof value === "string" && !/[\u0000-\u001f\u007f]/.test(value)
    && value.trim().length <= IMGBED_MAX_CHANNEL_NAME_LENGTH;
  const normalizeImgBedChannelName = (value) => {
    if (value == null || value === "") return "";
    if (!isImgBedChannelNameValid(value)) throw new Error("ImgBed channel name is invalid");
    return value.trim();
  };

  // ImgBed retries a failed write on the same type and then on other channel
  // types unless autoRetry=false. Unset follows the renderer default: retry
  // without a channel name (ImgBed's own default), no retry with one, so a named
  // channel never silently hands the image to other storage.
  const resolveImgBedAutoRetry = (value, channelName) => {
    if (value == null) return !channelName;
    if (typeof value !== "boolean") throw new Error("ImgBed retry setting is invalid");
    return value;
  };

  // `forceNoRetry` is set by the connection test: with a channel name it must
  // prove that this channel accepts the write, whatever the upload setting is.
  const buildUploadUrl = (input, { forceNoRetry = false } = {}) => {
    const url = normalizeImgBedEndpoint(input.endpoint);
    const folder = normalizeImgBedFolder(input.uploadFolder);
    const nameType = input.nameType ?? "default";
    if (!IMGBED_NAME_TYPES.includes(nameType)) throw new Error("ImgBed file naming is invalid");
    const channel = input.uploadChannel ?? "telegram";
    if (!IMGBED_UPLOAD_CHANNELS.includes(channel)) throw new Error("ImgBed upload channel is invalid");
    const channelName = normalizeImgBedChannelName(input.channelName);
    if (input.serverCompress != null && typeof input.serverCompress !== "boolean") throw new Error("ImgBed server compression is invalid");
    const autoRetry = forceNoRetry && channelName ? false : resolveImgBedAutoRetry(input.autoRetry, channelName);
    url.searchParams.set("uploadChannel", channel);
    if (channelName) url.searchParams.set("channelName", channelName);
    url.searchParams.set("autoRetry", String(autoRetry));
    url.searchParams.set("serverCompress", String(input.serverCompress ?? true));
    url.searchParams.set("uploadNameType", nameType);
    if (folder) url.searchParams.set("uploadFolder", folder);
    return url;
  };

  // Prefer publicUrl; otherwise resolve src against the ImgBed site.
  const resultUrl = (data, uploadUrl) => {
    const item = Array.isArray(data) && data.length === 1 ? data[0] : null;
    const raw = typeof item?.publicUrl === "string" && item.publicUrl ? item.publicUrl : item?.src;
    if (typeof raw !== "string" || !raw) throw new Error("ImgBed did not return an uploaded image URL");
    let url;
    try { url = new URL(raw, uploadUrl); }
    catch { throw new Error("ImgBed returned an invalid image URL"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new Error("ImgBed returned an invalid image URL");
    }
    return url.href;
  };

  const post = async (input, file, filename, { fetchImpl, timeoutMs, lookupImpl, forceNoRetry = false }) => {
    const url = buildUploadUrl(input, { forceNoRetry });
    const token = normalizeImgBedToken(input.token);
    await assertImageHostAllowed(url.hostname, lookupImpl, { label: LABEL, message: ADDRESS_ERROR });
    const form = new FormData();
    form.append("file", file, filename);
    let data;
    try {
      data = await postImageHostJson(url, form, fetchImpl, timeoutMs, { label: LABEL, headers: { Authorization: `Bearer ${token}` } });
    } catch (error) {
      if (/HTTP (401|403)$/.test(String(error?.message))) throw new Error(TOKEN_REJECTED);
      throw error;
    }
    return { url: resultUrl(data, url) };
  };

  // Markers let the settings page name the cause: IMGBED_CHANNELS_UNSUPPORTED: for
  // sites older than channel names, IMGBED_CHANNEL_NAME: for a name ImgBed lacks.
  // /api/channels shipped with channelName (ImgBed 2026-01), accepts any valid API
  // token and lists only enabled channels within quota, keyed by upload channel.
  // The settings page lists these names so the channel is picked, not typed.
  const listImgBedChannels = async (input, { fetchImpl = fetch, timeoutMs = 15000, lookupImpl = lookup } = {}) => {
    const url = normalizeImgBedEndpoint(input.endpoint);
    url.pathname = url.pathname.replace(/\/upload$/, "/api/channels");
    const token = normalizeImgBedToken(input.token);
    await assertImageHostAllowed(url.hostname, lookupImpl, { label: LABEL, message: ADDRESS_ERROR });
    let data;
    try {
      data = await postImageHostJson(url, undefined, fetchImpl, timeoutMs, { label: LABEL, method: "GET", headers: { Authorization: `Bearer ${token}` } });
    } catch (error) {
      const message = String(error?.message);
      if (/HTTP (401|403)$/.test(message)) throw new Error(TOKEN_REJECTED);
      // Sites older than channel names answer the unknown route with 404 or with
      // their small HTML app shell. Every other failure keeps its own message.
      if (message.endsWith("HTTP 404") || message.endsWith("returned an unreadable response")) {
        throw new Error(CHANNELS_UNSUPPORTED);
      }
      throw error;
    }
    // JSON of another shape (an error object, a proxy page) is a failure, not "no channels".
    if (!data || typeof data !== "object" || Array.isArray(data) || !IMGBED_UPLOAD_CHANNELS.some((channel) => Array.isArray(data[channel]))) {
      throw new Error("ImgBed returned an unexpected channel list");
    }
    // Keep only names EdgeEver can send back unchanged, once each, in ImgBed's order,
    // and count the rest so the settings page can say why a channel is missing.
    const channels = {};
    const skipped = {};
    for (const channel of IMGBED_UPLOAD_CHANNELS) {
      // The guard above proved data is an object; a missing or non-array key lists nothing.
      const names = (Array.isArray(data[channel]) ? data[channel] : []).map((item) => item?.name)
        .filter((name) => typeof name === "string" && name !== "");
      const usable = names.filter((name) => name === name.trim() && isImgBedChannelNameValid(name));
      channels[channel] = [...new Set(usable)];
      // Counted once per distinct name, like the usable ones.
      skipped[channel] = new Set(names).size - channels[channel].length;
    }
    return { channels, skipped };
  };

  // ImgBed silently uses its default channel when channelName matches nothing,
  // so the connection test checks the name before uploading.
  const assertImgBedChannelExists = async (input, options) => {
    const channelName = normalizeImgBedChannelName(input.channelName);
    if (!channelName) return;
    buildUploadUrl(input); // Validates every field before any request.
    const { channels } = await listImgBedChannels(input, options);
    if (!channels[input.uploadChannel ?? "telegram"].includes(channelName)) {
      throw new Error("IMGBED_CHANNEL_NAME: ImgBed has no enabled channel with this name for the selected upload channel");
    }
  };

  // ImgBed has no heartbeat, so the test uploads a 1×1 PNG to the configured folder.
  const testImgBedConnection = async (input, { fetchImpl = fetch, timeoutMs = 15000, lookupImpl = lookup } = {}) => {
    await assertImgBedChannelExists(input, { fetchImpl, timeoutMs, lookupImpl });
    await post(input, new Blob([TEST_IMAGE], { type: "image/png" }), "edgeever-connection-test.png", { fetchImpl, timeoutMs, lookupImpl, forceNoRetry: true });
    return true;
  };

  const uploadImgBedImage = async (input, { fetchImpl = fetch, timeoutMs = 60000, lookupImpl = lookup } = {}) => {
    const bytes = input.bytes;
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > IMGBED_MAX_IMAGE_BYTES
      || typeof input.mimeType !== "string" || !input.mimeType.startsWith("image/")) {
      throw new Error("ImgBed requires an image of up to 50 MB");
    }
    return post(input, new Blob([bytes], { type: input.mimeType }), String(input.filename || "image.png"), { fetchImpl, timeoutMs, lookupImpl });
  };

  return { IMGBED_NAME_TYPES, IMGBED_UPLOAD_CHANNELS, IMGBED_MAX_CHANNEL_NAME_LENGTH, IMGBED_MAX_IMAGE_BYTES, normalizeImgBedEndpoint, normalizeImgBedToken, normalizeImgBedFolder, normalizeImgBedChannelName, resolveImgBedAutoRetry, listImgBedChannels, testImgBedConnection, uploadImgBedImage };
};
