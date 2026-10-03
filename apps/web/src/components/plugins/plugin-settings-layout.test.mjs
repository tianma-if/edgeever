import { describe, expect, test } from "bun:test";
import { groupPluginSettingFields } from "./plugin-settings-layout.ts";

describe("plugin settings layout", () => {
  test("groups consecutive topic switches without absorbing unrelated switches", () => {
    const fields = [
      { key: "topics.ai", type: "boolean", label: "AI" },
      { key: "topics.engineering", type: "boolean", label: "Engineering" },
      { key: "topics.science", type: "boolean", label: "Science" },
      { key: "translation.auto-enabled", type: "boolean", label: "Translate" },
      { key: "translation.target-language", type: "select", label: "Language", options: [{ value: "en", label: "English" }] },
      { key: "digest.auto-enabled", type: "boolean", label: "Digest" },
    ];

    const groups = groupPluginSettingFields(fields);
    expect(groups.map((group) => ({ compact: group.compact, keys: group.fields.map((field) => field.key) }))).toEqual([
      { compact: true, keys: ["topics.ai", "topics.engineering", "topics.science"] },
      { compact: false, keys: ["translation.auto-enabled", "translation.target-language"] },
      { compact: false, keys: ["digest.auto-enabled"] },
    ]);
  });

  test("keeps short boolean runs in the standard full-width layout", () => {
    const fields = [
      { key: "alerts.email", type: "boolean", label: "Email" },
      { key: "alerts.push", type: "boolean", label: "Push" },
    ];

    expect(groupPluginSettingFields(fields).map((group) => ({ compact: group.compact, keys: group.fields.map((field) => field.key) }))).toEqual([
      { compact: false, keys: ["alerts.email", "alerts.push"] },
    ]);
  });

  test("keeps settings without dot namespaces in a single unified group", () => {
    const fields = [
      { key: "global-filter", type: "text", label: "Filter" },
      { key: "task-format", type: "select", label: "Format", options: [{ value: "dataview", label: "Dataview" }] },
      { key: "set-done-date", type: "boolean", label: "Done date" },
      { key: "set-cancelled-date", type: "boolean", label: "Cancelled date" },
      { key: "set-created-date", type: "boolean", label: "Created date" },
      { key: "recurrence-insert", type: "select", label: "Recurrence", options: [{ value: "before", label: "Before" }] },
    ];

    expect(groupPluginSettingFields(fields).map((group) => ({ compact: group.compact, keys: group.fields.map((field) => field.key) }))).toEqual([
      { compact: false, keys: ["global-filter", "task-format", "set-done-date", "set-cancelled-date", "set-created-date", "recurrence-insert"] },
    ]);
  });
});
