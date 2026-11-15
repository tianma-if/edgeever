// Node host validation and transport stay in the desktop main process.
import { lookup } from "node:dns/promises";
import { assertHostShape, assertImageHostAllowed, postImageHostJson } from "./picgo.mjs";
import { createImgBedClient } from "@edgeever/image-host/imgbed";

export const { IMGBED_NAME_TYPES, IMGBED_UPLOAD_CHANNELS, IMGBED_MAX_CHANNEL_NAME_LENGTH, IMGBED_MAX_IMAGE_BYTES, normalizeImgBedEndpoint, normalizeImgBedToken, normalizeImgBedFolder, normalizeImgBedChannelName, resolveImgBedAutoRetry, listImgBedChannels, testImgBedConnection, uploadImgBedImage } = createImgBedClient({
  assertHostShape, assertImageHostAllowed, postImageHostJson, lookup,
});
