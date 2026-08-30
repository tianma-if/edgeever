mod catalog;
mod database;
mod memo;
mod rpc;
mod sync;

use database::{data_dir, migrations_dir, open_database};
use rpc::{handle, RpcError, RpcRequest, PROTOCOL_VERSION};
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{self, BufRead, Write};
use std::time::{SystemTime, UNIX_EPOCH};

fn enqueue_change(
    database: &Connection,
    kind: &str,
    entity_id: &str,
    payload: &Value,
) -> Result<(), String> {
    if kind == "memo.update" {
        let existing: Option<(i64, String, String)> = database
            .query_row(
                "SELECT id, payload_json, status FROM _edgeever_sidecar_outbox WHERE kind = 'memo.update' AND entity_id = ?1 AND status IN ('pending', 'error', 'conflict') ORDER BY id LIMIT 1",
                [entity_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some((outbox_id, existing_payload, existing_status)) = existing {
            let previous: Value =
                serde_json::from_str(&existing_payload).unwrap_or_else(|_| json!({}));
            let mut merged = payload.clone();
            if let (Some(merged_object), Some(previous_object)) =
                (merged.as_object_mut(), previous.as_object())
            {
                // Keep the original remote base while replacing the document
                // with the newest local snapshot. This avoids conflicts caused
                // solely by multiple offline autosaves.
                for key in ["expectedRevision", "expectedContentHash", "editSessionId"] {
                    if let Some(value) = previous_object.get(key) {
                        merged_object.insert(key.to_owned(), value.clone());
                    }
                }
            }
            database
                .execute(
                    "UPDATE _edgeever_sidecar_outbox
                 SET payload_json = ?1,
                     status = CASE WHEN ?2 = 'conflict' THEN 'conflict' ELSE 'pending' END,
                     last_error = CASE WHEN ?2 = 'conflict' THEN last_error ELSE NULL END,
                     last_error_code = CASE WHEN ?2 = 'conflict' THEN last_error_code ELSE NULL END,
                     retryable = 1,
                     next_attempt_at = NULL,
                     version = version + 1,
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
                 WHERE id = ?3",
                    rusqlite::params![merged.to_string(), existing_status, outbox_id],
                )
                .map(|_| ())
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    database.execute(
        "INSERT INTO _edgeever_sidecar_outbox (kind, entity_id, payload_json) VALUES (?1, ?2, ?3)",
        rusqlite::params![kind, entity_id, payload.to_string()],
    ).map(|_| ()).map_err(|e| e.to_string())
}

fn memo_remap_base_key(memo_id: &str) -> String {
    format!("memo.remap-base:{memo_id}")
}

fn resolve_remapped_memo_base(
    database: &Connection,
    memo_id: &str,
    expected_revision: i64,
    expected_content_hash: &str,
) -> (i64, String, bool) {
    let key = memo_remap_base_key(memo_id);
    let Some(marker) =
        meta_value(database, &key).and_then(|value| serde_json::from_str::<Value>(&value).ok())
    else {
        return (expected_revision, expected_content_hash.to_owned(), false);
    };
    let matches_temporary_base = marker.get("temporaryRevision").and_then(Value::as_i64)
        == Some(expected_revision)
        && marker.get("temporaryContentHash").and_then(Value::as_str)
            == Some(expected_content_hash);
    if !matches_temporary_base {
        return (expected_revision, expected_content_hash.to_owned(), false);
    }
    (
        marker
            .get("remoteRevision")
            .and_then(Value::as_i64)
            .unwrap_or(expected_revision),
        marker
            .get("remoteContentHash")
            .and_then(Value::as_str)
            .unwrap_or(expected_content_hash)
            .to_owned(),
        true,
    )
}

fn meta_value(database: &Connection, key: &str) -> Option<String> {
    database
        .query_row(
            "SELECT value FROM _edgeever_sidecar_meta WHERE key = ?1",
            [key],
            |row| row.get(0),
        )
        .ok()
}

fn set_meta(database: &Connection, key: &str, value: &str) -> Result<(), String> {
    database.execute(
        "INSERT INTO _edgeever_sidecar_meta (key, value, updated_at) VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        rusqlite::params![key, value],
    ).map(|_| ()).map_err(|e| e.to_string())
}

fn string_param(params: &Value, key: &str) -> Result<String, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| format!("Missing string parameter: {key}"))
}

fn bool_param(params: &Value, key: &str, default: bool) -> bool {
    params.get(key).and_then(Value::as_bool).unwrap_or(default)
}

fn now_id(prefix: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{prefix}_{nanos}")
}

fn content_hash(markdown: &str, content_json: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(markdown.as_bytes());
    digest.update(content_json.as_bytes());
    format!("{:x}", digest.finalize())
}

fn markdown_doc(markdown: &str) -> Value {
    let content: Vec<Value> = markdown
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| json!({ "type": "paragraph", "content": [{ "type": "text", "text": line }] }))
        .collect();
    json!({ "type": "doc", "content": if content.is_empty() { vec![json!({ "type": "paragraph" })] } else { content } })
}

fn tags_from_json(value: &str) -> Vec<String> {
    serde_json::from_str(value).unwrap_or_default()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = data_dir();
    let mut database = open_database(&root, &migrations_dir())?;
    println!(
        "{}",
        json!({ "event": "ready", "protocolVersion": PROTOCOL_VERSION })
    );
    io::stdout().flush()?;

    for line in io::stdin().lock().lines() {
        let line = line?;
        let request: RpcRequest = serde_json::from_str(&line)?;
        let request_id = request.id.clone();
        let result = match handle(request, &mut database, &root, &migrations_dir()) {
            Ok(value) => json!({ "id": request_id, "result": value }),
            Err(message) => json!({
                "id": request_id,
                "error": RpcError { code: "sidecar_error", message },
            }),
        };
        println!("{result}");
        io::stdout().flush()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memo::{resolve_custom_merge_title, resolve_sidecar_merge_markdown};
    use crate::sync::{apply_sync_changes, prepare_sync_bootstrap};

    #[test]
    fn string_param_rejects_missing_or_non_string_values() {
        assert_eq!(
            string_param(&json!({ "name": "EdgeEver" }), "name").unwrap(),
            "EdgeEver"
        );
        assert!(string_param(&json!({}), "name").is_err());
        assert!(string_param(&json!({ "name": 42 }), "name").is_err());
    }

    #[test]
    fn markdown_doc_produces_a_tiptap_document() {
        let document = markdown_doc("# Heading\n\nBody");
        assert_eq!(document.get("type").and_then(Value::as_str), Some("doc"));
        assert!(document
            .get("content")
            .and_then(Value::as_array)
            .map(|nodes| !nodes.is_empty())
            .unwrap_or(false));
    }

    #[test]
    fn content_hash_is_stable_and_content_sensitive() {
        let json = markdown_doc("same").to_string();
        let first = content_hash("same", &json);
        assert_eq!(first, content_hash("same", &json));
        assert_ne!(first, content_hash("different", &json));
    }

    #[test]
    fn merge_title_skips_untitled_sources() {
        assert_eq!(
            resolve_custom_merge_title(["无标题笔记", "  手动标题  ", "另一个标题"]),
            Some("手动标题".to_owned())
        );
        assert_eq!(resolve_custom_merge_title(["无标题笔记", "  "]), None);
    }

    #[test]
    fn merge_content_falls_back_to_stored_text_when_markdown_is_empty() {
        assert_eq!(
            resolve_sidecar_merge_markdown("", "正文仍然存在", r#"{"type":"doc","content":[]}"#)
                .unwrap(),
            "正文仍然存在"
        );
        assert_eq!(
            resolve_sidecar_merge_markdown(
                "**保留格式**",
                "保留格式",
                r#"{"type":"doc","content":[]}"#
            )
            .unwrap(),
            "**保留格式**"
        );
        assert!(resolve_sidecar_merge_markdown(
            "",
            "",
            r#"{"type":"doc","content":[{"type":"image","attrs":{"src":"image.png"}}]}"#
        )
        .is_err());
    }

    #[test]
    fn mirror_reset_removes_stale_cache_and_preserves_outbox_drafts() {
        let database = Connection::open_in_memory().unwrap();
        database
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE _edgeever_sidecar_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
                 CREATE TABLE _edgeever_sidecar_outbox (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, entity_id TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending');
                 CREATE TABLE notebooks (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES notebooks(id) ON DELETE RESTRICT, name TEXT NOT NULL);
                 CREATE TABLE memos (id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE RESTRICT, title TEXT);
                 CREATE TABLE memo_contents (memo_id TEXT PRIMARY KEY REFERENCES memos(id) ON DELETE CASCADE, content_markdown TEXT NOT NULL);
                 CREATE TABLE resources (id TEXT PRIMARY KEY, memo_id TEXT NOT NULL REFERENCES memos(id) ON DELETE RESTRICT);
                 INSERT INTO _edgeever_sidecar_meta VALUES ('sync.cursor', '42', 'now'), ('sync.identity', 'workspace-a', 'now');
                 INSERT INTO notebooks VALUES ('stale-notebook', NULL, 'Stale'), ('draft-parent', NULL, 'Draft parent'), ('draft-notebook', 'draft-parent', 'Draft');
                 INSERT INTO memos VALUES ('stale-memo', 'stale-notebook', 'Stale cache'), ('draft-memo', 'draft-notebook', 'Unsynced draft');
                 INSERT INTO memo_contents VALUES ('stale-memo', 'stale'), ('draft-memo', 'local changes');
                 INSERT INTO resources VALUES ('stale-resource', 'stale-memo'), ('draft-resource', 'draft-memo');
                 INSERT INTO _edgeever_sidecar_outbox (id, kind, entity_id, payload_json) VALUES (1, 'memo.update', 'draft-memo', '{\"memoId\":\"draft-memo\"}');",
            )
            .unwrap();

        let result = prepare_sync_bootstrap(&database, &json!({ "reset": true })).unwrap();
        assert_eq!(
            result.get("rebuiltMirror").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            database
                .query_row(
                    "SELECT COUNT(*) FROM memos WHERE id = 'stale-memo'",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        assert_eq!(
            database
                .query_row(
                    "SELECT content_markdown FROM memo_contents WHERE memo_id = 'draft-memo'",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
            "local changes"
        );
        assert_eq!(
            database
                .query_row(
                    "SELECT COUNT(*) FROM notebooks WHERE id IN ('draft-parent', 'draft-notebook')",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            2
        );
        assert_eq!(
            database
                .query_row(
                    "SELECT COUNT(*) FROM resources WHERE id = 'draft-resource'",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
        assert!(meta_value(&database, "sync.cursor").is_none());

        apply_sync_changes(
            &database,
            &json!({ "changes": [{
                "entityType": "memo",
                "operation": "upsert",
                "entityId": "draft-memo",
                "memo": { "title": "Cloud snapshot must not overwrite this" }
            }] }),
        )
        .unwrap();
        assert_eq!(
            database
                .query_row(
                    "SELECT title FROM memos WHERE id = 'draft-memo'",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
            "Unsynced draft"
        );
    }
}
