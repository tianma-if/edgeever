import type { ExtensionManifest } from "@edgeever/plugin-api";
import type { PluginHostSnapshot, RegisteredPluginAction } from "./plugin-host";

export type PluginDetailPage = "overview" | "settings";

export const hasPluginSettings = (manifest: ExtensionManifest) =>
  manifest.type === "plugin" && (manifest.settings?.fields.length ?? 0) > 0;

export const getPluginDetailPath = (pluginId: string, page: PluginDetailPage = "overview") =>
  `/plugins/${encodeURIComponent(pluginId)}${page === "settings" ? "?view=settings" : ""}`;

export const getPluginDetailPage = (manifest: ExtensionManifest, requestedPage: string | null): PluginDetailPage =>
  requestedPage === "settings" && hasPluginSettings(manifest) ? "settings" : "overview";

export const getPluginToolbarGroups = (snapshot: Pick<PluginHostSnapshot, "extensions" | "commands" | "panels">) =>
  snapshot.extensions.flatMap((extension) => {
    if (extension.manifest.type !== "plugin") return [];
    const hasSettings = hasPluginSettings(extension.manifest);
    const actions: RegisteredPluginAction[] = extension.enabled ? [
      ...snapshot.commands.filter((command) => command.pluginId === extension.manifest.id).map((command) => ({ ...command, type: "command" as const })),
      ...snapshot.panels.filter((panel) => panel.pluginId === extension.manifest.id).map((panel) => ({ ...panel, type: "panel" as const })),
    ] : [];
    return actions.length || hasSettings
      ? [{ pluginId: extension.manifest.id, name: extension.manifest.name, actions, hasSettings }]
      : [];
  });
