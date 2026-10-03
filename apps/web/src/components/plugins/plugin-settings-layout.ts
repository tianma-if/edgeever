import type { PluginSettingField } from "@edgeever/plugin-api";

export interface PluginSettingFieldGroup {
  id: string;
  compact: boolean;
  fields: PluginSettingField[];
}

const fieldNamespace = (field: PluginSettingField) => {
  const dotIndex = field.key.indexOf(".");
  return dotIndex === -1 ? "" : field.key.slice(0, dotIndex);
};

export const groupPluginSettingFields = (fields: PluginSettingField[]): PluginSettingFieldGroup[] => {
  const groups: PluginSettingFieldGroup[] = [];
  for (let index = 0; index < fields.length;) {
    const field = fields[index]!;
    const namespace = fieldNamespace(field);
    let end = index + 1;
    while (end < fields.length && fieldNamespace(fields[end]!) === namespace) end += 1;
    const run = fields.slice(index, end);
    groups.push({
      id: `${namespace || "default"}:${field.key}`,
      compact: Boolean(namespace) && run.length >= 3 && run.every((item) => item.type === "boolean"),
      fields: run,
    });
    index = end;
  }
  return groups;
};
