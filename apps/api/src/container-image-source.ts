export type ContainerImageSource =
  | "official-ghcr"
  | "official-cn-mirror"
  | "custom"
  | "unknown";

const OFFICIAL_GHCR_IMAGE = "ghcr.io/tianma-if/edgeever";
const OFFICIAL_CN_MIRROR_IMAGE = "ccr.ccs.tencentyun.com/edgeever/edgeever";

const matchesImageRepository = (reference: string, repository: string) =>
  reference === repository
  || reference.startsWith(`${repository}:`)
  || reference.startsWith(`${repository}@`);

export const resolveContainerImageSource = (
  imageReference: string | null | undefined,
): ContainerImageSource => {
  const normalized = imageReference?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "") ?? "";
  if (!normalized) return "unknown";
  if (matchesImageRepository(normalized, OFFICIAL_GHCR_IMAGE)) return "official-ghcr";
  if (matchesImageRepository(normalized, OFFICIAL_CN_MIRROR_IMAGE)) return "official-cn-mirror";
  return "custom";
};
