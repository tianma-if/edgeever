import {
  resolveDeploymentMethod,
  resolveDeploymentTrigger,
  type DeploymentMetadata,
} from "@edgeever/shared/deployment-metadata";

type DeploymentMetadataInput = {
  trigger?: string | null;
  method?: string | null;
};

export const resolveSystemInfoDeploymentMetadata = (
  instanceDeployment: DeploymentMetadataInput | null | undefined,
  clientBuildDeployment: DeploymentMetadataInput,
  allowClientBuildFallback: boolean,
): DeploymentMetadata => ({
  trigger: resolveDeploymentTrigger(
    instanceDeployment?.trigger
      ?? (allowClientBuildFallback ? clientBuildDeployment.trigger ?? undefined : undefined),
  ),
  method: resolveDeploymentMethod(
    instanceDeployment?.method
      ?? (allowClientBuildFallback ? clientBuildDeployment.method ?? undefined : undefined),
  ),
});
