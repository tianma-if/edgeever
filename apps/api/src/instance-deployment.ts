import {
  resolveDeploymentMethod,
  resolveDeploymentTrigger,
  type DeploymentMetadata,
} from "@edgeever/shared/deployment-metadata";
import type { Bindings } from "./api-context";

declare const __EDGEEVER_INSTANCE_DEPLOYMENT_TRIGGER__: string;
declare const __EDGEEVER_INSTANCE_DEPLOYMENT_METHOD__: string;

const bundledTrigger = typeof __EDGEEVER_INSTANCE_DEPLOYMENT_TRIGGER__ !== "undefined"
  ? __EDGEEVER_INSTANCE_DEPLOYMENT_TRIGGER__
  : "";
const bundledMethod = typeof __EDGEEVER_INSTANCE_DEPLOYMENT_METHOD__ !== "undefined"
  ? __EDGEEVER_INSTANCE_DEPLOYMENT_METHOD__
  : "";

export const resolveInstanceDeploymentMetadata = (
  environment: Pick<Bindings, "EDGE_EVER_DEPLOYMENT_TRIGGER" | "EDGE_EVER_DEPLOYMENT_METHOD">,
): DeploymentMetadata => ({
  trigger: resolveDeploymentTrigger(environment.EDGE_EVER_DEPLOYMENT_TRIGGER?.trim() || bundledTrigger),
  method: resolveDeploymentMethod(environment.EDGE_EVER_DEPLOYMENT_METHOD?.trim() || bundledMethod),
});
