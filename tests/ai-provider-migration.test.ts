import { globSync, readFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

describe("AI provider migration", () => {
  test("preserves the legacy provider as one service with one default model", () => {
    const db = new Database(":memory:");
    const migrations = globSync("migrations/*.sql").sort();
    const providerMigrationIndex = migrations.findIndex((path) => path.endsWith("0025_ai_providers_and_models.sql"));

    for (const migration of migrations.slice(0, providerMigrationIndex)) {
      db.exec(readFileSync(migration, "utf8"));
    }
    db.query(
      `INSERT INTO ai_model_configs (
         id, workspace_id, provider, display_name, base_url,
         api_key_encrypted, model_id, is_enabled
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "ai_legacy",
      "ws_default",
      "openai-compatible",
      "OpenRouter",
      "https://openrouter.ai/api/v1",
      "encrypted-key",
      "anthropic/claude-sonnet-4",
      1,
    );

    for (const migration of migrations.slice(providerMigrationIndex)) {
      db.exec(readFileSync(migration, "utf8"));
    }

    expect(db.query(
      `SELECT id, display_name, is_enabled FROM ai_provider_configs WHERE workspace_id = ?`,
    ).get("ws_default")).toEqual({ id: "ai_legacy", display_name: "OpenRouter", is_enabled: 1 });
    expect(db.query(
      `SELECT id, provider_config_id, model_id FROM ai_models WHERE provider_config_id = ?`,
    ).get("ai_legacy")).toEqual({
      id: "aim_ai_legacy",
      provider_config_id: "ai_legacy",
      model_id: "anthropic/claude-sonnet-4",
    });
    expect(db.query(
      `SELECT default_model_id FROM ai_workspace_settings WHERE workspace_id = ?`,
    ).get("ws_default")).toEqual({ default_model_id: "aim_ai_legacy" });

    db.query("DELETE FROM ai_provider_configs WHERE id = ?").run("ai_legacy");
    expect(db.query(
      `SELECT default_model_id FROM ai_workspace_settings WHERE workspace_id = ?`,
    ).get("ws_default")).toEqual({ default_model_id: null });
  });
});
