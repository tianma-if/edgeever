declare const __EDGEEVER_INSTANCE_BUILD_ID__: string;

const bundledBuildId = typeof __EDGEEVER_INSTANCE_BUILD_ID__ !== "undefined"
  ? __EDGEEVER_INSTANCE_BUILD_ID__
  : "";
const runtimeBuildId = typeof process !== "undefined"
  ? process.env.EDGE_EVER_BUILD_ID ?? process.env.GITHUB_SHA ?? ""
  : "";

export const INSTANCE_BUILD_ID = (bundledBuildId || runtimeBuildId).trim() || "unknown";
