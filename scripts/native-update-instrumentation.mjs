export const instrumentNativeUpdateMain = (originalMain, runtimeConfigPath) => {
  const replace = (source, from, to) => {
    if (source.split(from).length !== 2) throw new Error(`Expected exactly one instrumentation site: ${from}`);
    return source.replace(from, to);
  };
  let instrumented = `import { verifierLog, verifierWindowsMetadata, attachVerifier } from "./native-update-verifier.mjs";\n${originalMain}`;
  instrumented = replace(instrumented, 'if (requestedUserDataDirectory) app.setPath("userData", requestedUserDataDirectory);', 'app.setPath("userData", process.env.EDGE_EVER_UPDATE_VERIFIER_PROFILE);');
  instrumented = replace(instrumented, '  desktopUpdateController = createDesktopUpdateController({', `  autoUpdater.setFeedURL({ provider: "generic", url: process.env.EDGE_EVER_UPDATE_VERIFIER_FEED + "/feed" });\n  autoUpdater.disableDifferentialDownload = true;\n  desktopUpdateController = createDesktopUpdateController({`);
  instrumented = replace(instrumented, 'fetchWindowsMetadata: (options) => fetchTrustedWindowsUpdate({ ...options, fetchImpl: net.fetch }),', 'fetchWindowsMetadata: verifierWindowsMetadata,');
  instrumented = replace(instrumented, '    onDownloaded: (version) => {', '    onDownloaded: (version) => {\n      verifierLog("ready", { version, runningVersion: app.getVersion() });\n      return;');
  instrumented = replace(instrumented, '  void checkForDesktopUpdate("startup", { force: true });', '  attachVerifier({ app, updater: autoUpdater, controller: desktopUpdateController });\n  void checkForDesktopUpdate("startup", { force: true });');
  instrumented = instrumented.replace('  await confirmMacInstallation();', '  // Verification bundle stays in its isolated runner directory.');
  instrumented = instrumented.replace('  await ejectMountedMacInstallers();', '  // Verification does not eject unrelated volumes.');
  if (runtimeConfigPath) {
    instrumented = 'import { readFileSync as readVerifierConfig } from "node:fs";\n' + instrumented;
    const bootstrap = `for (const [key, value] of Object.entries(JSON.parse(readVerifierConfig(${JSON.stringify(runtimeConfigPath)}, "utf8")))) process.env[key] = value;\n`;
    instrumented = instrumented.replace('const { autoUpdater } = electronUpdater;', bootstrap + 'const { autoUpdater } = electronUpdater;');
  }
  return instrumented;
};
