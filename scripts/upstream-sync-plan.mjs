import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const noUpdate = (reason, forceRedeploy) => ({
  alignMode: "none",
  reason,
  republishOnly: forceRedeploy,
  updateRequired: false,
});

const update = (alignMode, reason) => ({
  alignMode,
  reason,
  republishOnly: false,
  updateRequired: true,
});

export function decideUpstreamSync({
  contentMatchesTarget,
  forceRedeploy,
  headEqualsTarget,
  headIsAncestorOfTarget,
  preserveForkChanges,
  targetIsAncestorOfHead,
}) {
  if (contentMatchesTarget) {
    return noUpdate(headEqualsTarget ? "already_on_target" : "content_matches_target", forceRedeploy);
  }

  if (!preserveForkChanges) {
    if (headIsAncestorOfTarget) {
      return update("snapshot", "behind_target");
    }
    if (targetIsAncestorOfHead) {
      return update("snapshot", "deploy_mirror_ahead");
    }
    return update("snapshot", "deploy_mirror_reset");
  }

  if (headIsAncestorOfTarget) {
    return update("snapshot", "behind_target");
  }
  if (targetIsAncestorOfHead) {
    return noUpdate("customized_contains_target", forceRedeploy);
  }
  return update("merge", "customized_merge");
}

function readBooleanEnvironment(name) {
  const value = process.env[name];
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be either true or false`);
}

export const shouldRedeploy = ({ eventName, forceRedeploy }) =>
  forceRedeploy || eventName === "workflow_dispatch";

function runCli() {
  // Older deployment Forks keep their local workflow bootstrap, where manual
  // runs passed FORCE_REDEPLOY=false unless a checkbox was discovered and set.
  // GitHub always provides GITHUB_EVENT_NAME, so a planner loaded from a newer
  // upstream target can give those Forks the corrected manual-run behavior too.
  const forceRedeploy = shouldRedeploy({
    eventName: process.env.GITHUB_EVENT_NAME,
    forceRedeploy: readBooleanEnvironment("EDGE_SYNC_FORCE_REDEPLOY"),
  });
  const plan = decideUpstreamSync({
    contentMatchesTarget: readBooleanEnvironment("EDGE_SYNC_CONTENT_MATCHES_TARGET"),
    forceRedeploy,
    headEqualsTarget: readBooleanEnvironment("EDGE_SYNC_HEAD_EQUALS_TARGET"),
    headIsAncestorOfTarget: readBooleanEnvironment("EDGE_SYNC_HEAD_IS_ANCESTOR_OF_TARGET"),
    preserveForkChanges: readBooleanEnvironment("EDGE_SYNC_PRESERVE_FORK_CHANGES"),
    targetIsAncestorOfHead: readBooleanEnvironment("EDGE_SYNC_TARGET_IS_ANCESTOR_OF_HEAD"),
  });
  process.stdout.write(
    `${plan.updateRequired}\t${plan.alignMode}\t${plan.reason}\t${plan.republishOnly}\n`,
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  runCli();
}
