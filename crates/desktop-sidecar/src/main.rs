mod database;

use database::{
    backup_database, data_dir, list_backups, migrations_dir, open_database, restore_database,
};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::env;
use std::io::{self, BufRead, Write};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

const PROTOCOL_VERSION: i64 = 2;

#[derive(Debug, Deserialize)]
struct RpcRequest {
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct RpcError<'a> {
    code: &'a str,
    message: String,
}

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

fn summary_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let tags: String = row.get("tags_json")?;
    Ok(json!({
        "id": row.get::<_, String>("id")?,
        "notebookId": row.get::<_, String>("notebook_id")?,
        "title": row.get::<_, Option<String>>("title")?,
        "excerpt": row.get::<_, String>("excerpt")?,
        "tags": tags_from_json(&tags),
        "isPinned": row.get::<_, i64>("is_pinned")? != 0,
        "isArchived": row.get::<_, i64>("is_archived")? != 0,
        "isDeleted": row.get::<_, i64>("is_deleted")? != 0,
        "revision": row.get::<_, i64>("revision")?,
        "createdAt": row.get::<_, String>("created_at")?,
        "updatedAt": row.get::<_, String>("updated_at")?,
        "deletedAt": row.get::<_, Option<String>>("deleted_at")?,
    }))
}

fn memo_value(
    database: &Connection,
    memo_id: &str,
    include_deleted: bool,
) -> Result<Value, String> {
    let mut statement = database.prepare(
        "SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned, m.is_archived, m.is_deleted,
                m.source_memo_ids, m.merge_source_count, m.merged_into_memo_id, m.created_at, m.updated_at, m.deleted_at,
                c.content_json, c.content_markdown, c.content_text, c.content_hash, c.revision
           FROM memos m JOIN memo_contents c ON c.memo_id = m.id
          WHERE m.id = ?1 AND (?2 OR m.is_deleted = 0)",
    ).map_err(|e| e.to_string())?;
    statement.query_row(rusqlite::params![memo_id, include_deleted as i64], |row| {
        let tags: String = row.get("tags_json")?;
        let source_ids: String = row.get("source_memo_ids")?;
        let content_json: String = row.get("content_json")?;
        Ok(json!({
            "id": row.get::<_, String>("id")?, "notebookId": row.get::<_, String>("notebook_id")?,
            "title": row.get::<_, Option<String>>("title")?, "excerpt": row.get::<_, String>("excerpt")?,
            "tags": tags_from_json(&tags), "isPinned": row.get::<_, i64>("is_pinned")? != 0,
            "isArchived": row.get::<_, i64>("is_archived")? != 0, "isDeleted": row.get::<_, i64>("is_deleted")? != 0,
            "revision": row.get::<_, i64>("revision")?, "createdAt": row.get::<_, String>("created_at")?,
            "updatedAt": row.get::<_, String>("updated_at")?, "deletedAt": row.get::<_, Option<String>>("deleted_at")?,
            "contentJson": serde_json::from_str::<Value>(&content_json).unwrap_or_else(|_| json!({"type":"doc","content":[]})),
            "contentMarkdown": row.get::<_, String>("content_markdown")?, "contentText": row.get::<_, String>("content_text")?,
            "contentHash": row.get::<_, String>("content_hash")?, "sourceMemoIds": tags_from_json(&source_ids),
            "mergeSourceCount": row.get::<_, i64>("merge_source_count")?, "mergedIntoMemoId": row.get::<_, Option<String>>("merged_into_memo_id")?,
        }))
    }).map_err(|e| e.to_string())
}

fn insert_revision(
    transaction: &rusqlite::Transaction<'_>,
    memo: &Value,
    created_by: &str,
) -> Result<(), String> {
    let memo_id = string_param(memo, "id")?;
    let content_json = memo
        .get("contentJson")
        .cloned()
        .unwrap_or_else(|| json!({"type":"doc","content":[]}));
    let tags = memo.get("tags").cloned().unwrap_or_else(|| json!([]));
    transaction.execute(
        "INSERT INTO memo_revisions (id, memo_id, revision, title, content_json, content_markdown, content_hash, created_by, created_at, tags_json, content_text) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?9, ?10)",
        rusqlite::params![
            now_id("revision_local"), memo_id,
            memo.get("revision").and_then(Value::as_i64).unwrap_or(0),
            memo.get("title").and_then(Value::as_str), content_json.to_string(),
            memo.get("contentMarkdown").and_then(Value::as_str).unwrap_or(""),
            memo.get("contentHash").and_then(Value::as_str).unwrap_or(""), created_by,
            tags.to_string(), memo.get("contentText").and_then(Value::as_str).unwrap_or(""),
        ],
    ).map(|_| ()).map_err(|e| e.to_string())
}

fn revision_value(
    database: &Connection,
    memo_id: &str,
    revision_id: &str,
) -> Result<Value, String> {
    database.query_row(
        "SELECT id, memo_id, revision, title, tags_json, content_json, content_markdown, content_text, content_hash, created_by, created_at FROM memo_revisions WHERE id = ?1 AND memo_id = ?2",
        rusqlite::params![revision_id, memo_id],
        |row| {
            let tags: String = row.get(4)?;
            let content_json: String = row.get(5)?;
            Ok(json!({
                "id": row.get::<_, String>(0)?, "memoId": row.get::<_, String>(1)?, "revision": row.get::<_, i64>(2)?,
                "title": row.get::<_, Option<String>>(3)?, "tags": tags_from_json(&tags),
                "contentJson": serde_json::from_str::<Value>(&content_json).unwrap_or_else(|_| json!({"type":"doc","content":[]})),
                "contentMarkdown": row.get::<_, String>(6)?, "contentText": row.get::<_, String>(7)?,
                "contentHash": row.get::<_, String>(8)?, "createdBy": row.get::<_, String>(9)?, "createdAt": row.get::<_, String>(10)?,
            }))
        },
    ).map_err(|e| e.to_string())
}

fn list_memo_revisions(database: &Connection, params: &Value) -> Result<Value, String> {
    let memo_id = string_param(params, "memoId")?;
    let limit = params
        .get("limit")
        .and_then(Value::as_i64)
        .unwrap_or(100)
        .clamp(1, 200);
    let mut statement = database.prepare("SELECT id, memo_id, revision, title, tags_json, content_json, content_markdown, content_text, content_hash, created_by, created_at FROM memo_revisions WHERE memo_id = ?1 ORDER BY revision DESC, created_at DESC LIMIT ?2").map_err(|e| e.to_string())?;
    let rows = statement.query_map(rusqlite::params![memo_id, limit], |row| {
        let tags: String = row.get(4)?;
        let content_json: String = row.get(5)?;
        Ok(json!({
            "id": row.get::<_, String>(0)?, "memoId": row.get::<_, String>(1)?, "revision": row.get::<_, i64>(2)?,
            "title": row.get::<_, Option<String>>(3)?, "tags": tags_from_json(&tags),
            "contentJson": serde_json::from_str::<Value>(&content_json).unwrap_or_else(|_| json!({"type":"doc","content":[]})),
            "contentMarkdown": row.get::<_, String>(6)?, "contentText": row.get::<_, String>(7)?,
            "contentHash": row.get::<_, String>(8)?, "createdBy": row.get::<_, String>(9)?, "createdAt": row.get::<_, String>(10)?,
        }))
    }).map_err(|e| e.to_string())?;
    let revisions: Result<Vec<_>, _> = rows.collect();
    Ok(json!({ "revisions": revisions.map_err(|e| e.to_string())? }))
}

fn cache_memo_revision(database: &Connection, params: &Value) -> Result<Value, String> {
    let revision = params
        .get("revision")
        .ok_or_else(|| "Missing revision".to_owned())?;
    let memo_id = string_param(revision, "memoId")?;
    let revision_id = string_param(revision, "id")?;
    let content_json = revision
        .get("contentJson")
        .cloned()
        .unwrap_or_else(|| json!({"type":"doc","content":[]}));
    let tags = revision.get("tags").cloned().unwrap_or_else(|| json!([]));
    database.execute(
        "INSERT INTO memo_revisions (id, memo_id, revision, title, content_json, content_markdown, content_hash, created_by, created_at, tags_json, content_text) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) ON CONFLICT(id) DO UPDATE SET memo_id=excluded.memo_id, revision=excluded.revision, title=excluded.title, content_json=excluded.content_json, content_markdown=excluded.content_markdown, content_hash=excluded.content_hash, created_by=excluded.created_by, created_at=excluded.created_at, tags_json=excluded.tags_json, content_text=excluded.content_text",
        rusqlite::params![
            revision_id, memo_id, revision.get("revision").and_then(Value::as_i64).unwrap_or(0),
            revision.get("title").and_then(Value::as_str), content_json.to_string(),
            revision.get("contentMarkdown").and_then(Value::as_str).unwrap_or(""),
            revision.get("contentHash").and_then(Value::as_str).unwrap_or(""),
            revision.get("createdBy").and_then(Value::as_str).unwrap_or("remote"),
            revision.get("createdAt").and_then(Value::as_str).unwrap_or(""), tags.to_string(),
            revision.get("contentText").and_then(Value::as_str).unwrap_or(""),
        ],
    ).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

fn list_notebooks(database: &Connection) -> Result<Value, String> {
    let mut statement = database.prepare(
        "SELECT n.id, n.parent_id, n.name, n.slug, n.icon, n.color, n.sort_order, n.created_at, n.updated_at,
                COUNT(CASE WHEN m.is_deleted = 0 THEN 1 END) AS memo_count,
                MAX(CASE WHEN m.is_deleted = 0 THEN m.updated_at END) AS last_memo_updated_at
           FROM notebooks n LEFT JOIN memos m ON m.notebook_id = n.id
          WHERE n.is_deleted = 0 GROUP BY n.id ORDER BY n.sort_order, n.name",
    ).map_err(|e| e.to_string())?;
    let rows = statement.query_map([], |row| Ok(json!({
        "id": row.get::<_, String>("id")?, "parentId": row.get::<_, Option<String>>("parent_id")?,
        "name": row.get::<_, String>("name")?, "slug": row.get::<_, Option<String>>("slug")?,
        "icon": row.get::<_, Option<String>>("icon")?, "color": row.get::<_, Option<String>>("color")?,
        "sortOrder": row.get::<_, i64>("sort_order")?, "memoCount": row.get::<_, i64>("memo_count")?,
        "lastMemoUpdatedAt": row.get::<_, Option<String>>("last_memo_updated_at")?,
        "createdAt": row.get::<_, String>("created_at")?, "updatedAt": row.get::<_, String>("updated_at")?,
    }))).map_err(|e| e.to_string())?;
    let notebooks: Result<Vec<_>, _> = rows.collect();
    Ok(json!({ "notebooks": notebooks.map_err(|e| e.to_string())? }))
}

fn notebook_value(
    database: &Connection,
    notebook_id: &str,
    include_deleted: bool,
) -> Result<Value, String> {
    let mut statement = database.prepare(
        "SELECT n.id, n.parent_id, n.name, n.slug, n.icon, n.color, n.sort_order, n.created_at, n.updated_at,
                COUNT(CASE WHEN m.is_deleted = 0 THEN 1 END) AS memo_count,
                MAX(CASE WHEN m.is_deleted = 0 THEN m.updated_at END) AS last_memo_updated_at
           FROM notebooks n LEFT JOIN memos m ON m.notebook_id = n.id
          WHERE n.id = ?1 AND (?2 OR n.is_deleted = 0) GROUP BY n.id",
    ).map_err(|e| e.to_string())?;
    statement.query_row(rusqlite::params![notebook_id, include_deleted as i64], |row| Ok(json!({
        "id": row.get::<_, String>("id")?, "parentId": row.get::<_, Option<String>>("parent_id")?,
        "name": row.get::<_, String>("name")?, "slug": row.get::<_, Option<String>>("slug")?,
        "icon": row.get::<_, Option<String>>("icon")?, "color": row.get::<_, Option<String>>("color")?,
        "sortOrder": row.get::<_, i64>("sort_order")?, "memoCount": row.get::<_, i64>("memo_count")?,
        "lastMemoUpdatedAt": row.get::<_, Option<String>>("last_memo_updated_at")?,
        "createdAt": row.get::<_, String>("created_at")?, "updatedAt": row.get::<_, String>("updated_at")?,
    }))).map_err(|e| e.to_string())
}

fn create_notebook(database: &Connection, params: &Value) -> Result<Value, String> {
    let name = string_param(params, "name")?;
    let parent_id = params.get("parentId").and_then(Value::as_str);
    let id = now_id("nb_local");
    database.execute("INSERT INTO notebooks (id, parent_id, name, slug, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)", rusqlite::params![id, parent_id, name, name.to_lowercase().replace(' ', "-"), SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as i64]).map_err(|e| e.to_string())?;
    let notebook = notebook_value(database, &id, true)?;
    enqueue_change(
        database,
        "notebook.create",
        &id,
        &json!({ "temporaryId": id, "name": name, "parentId": parent_id }),
    )?;
    Ok(notebook)
}

fn update_notebook(database: &Connection, params: &Value) -> Result<Value, String> {
    let notebook_id = string_param(params, "notebookId")?;
    if let Some(name) = params.get("name").and_then(Value::as_str) {
        database.execute("UPDATE notebooks SET name = ?1, slug = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?3 AND is_deleted = 0", rusqlite::params![name, name.to_lowercase().replace(' ', "-"), notebook_id]).map_err(|e| e.to_string())?;
    }
    if params.get("parentId").is_some() {
        database.execute("UPDATE notebooks SET parent_id = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?2 AND is_deleted = 0", rusqlite::params![params.get("parentId").and_then(Value::as_str), notebook_id]).map_err(|e| e.to_string())?;
    }
    if let Some(sort_order) = params.get("sortOrder").and_then(Value::as_i64) {
        database.execute("UPDATE notebooks SET sort_order = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?2 AND is_deleted = 0", rusqlite::params![sort_order, notebook_id]).map_err(|e| e.to_string())?;
    }
    let notebook = notebook_value(database, &notebook_id, true)?;
    enqueue_change(database, "notebook.update", &notebook_id, params)?;
    Ok(notebook)
}

fn delete_notebook(database: &Connection, params: &Value) -> Result<Value, String> {
    let notebook_id = string_param(params, "notebookId")?;
    let child_count: i64 = database
        .query_row(
            "SELECT COUNT(*) FROM notebooks WHERE parent_id = ?1 AND is_deleted = 0",
            [&notebook_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let memo_count: i64 = database
        .query_row(
            "SELECT COUNT(*) FROM memos WHERE notebook_id = ?1 AND is_deleted = 0",
            [&notebook_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if child_count > 0 || memo_count > 0 {
        return Err("notebook_not_empty".to_owned());
    }
    database.execute("UPDATE notebooks SET is_deleted = 1, deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1 AND slug <> 'inbox'", [&notebook_id]).map_err(|e| e.to_string())?;
    enqueue_change(
        database,
        "notebook.delete",
        &notebook_id,
        &json!({ "notebookId": notebook_id }),
    )?;
    Ok(json!({ "ok": true }))
}

fn restore_notebook(database: &Connection, params: &Value) -> Result<Value, String> {
    let notebook_id = string_param(params, "notebookId")?;
    let changed = database.execute("UPDATE notebooks SET is_deleted = 0, deleted_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1 AND slug <> 'inbox'", [&notebook_id]).map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err(format!("Notebook not found: {notebook_id}"));
    }
    let notebook = notebook_value(database, &notebook_id, true)?;
    enqueue_change(
        database,
        "notebook.restore",
        &notebook_id,
        &json!({ "notebookId": notebook_id }),
    )?;
    Ok(notebook)
}

fn template_value(database: &Connection, template_id: &str) -> Result<Value, String> {
    let mut statement = database.prepare("SELECT id, name, description, title, content_json, content_markdown, tags_json, created_at, updated_at FROM memo_templates WHERE id = ?1").map_err(|e| e.to_string())?;
    statement.query_row([template_id], |row| {
        let content_json: String = row.get("content_json")?;
        let tags: String = row.get("tags_json")?;
        Ok(json!({ "id": row.get::<_, String>("id")?, "name": row.get::<_, String>("name")?, "description": row.get::<_, Option<String>>("description")?, "title": row.get::<_, Option<String>>("title")?, "contentJson": serde_json::from_str::<Value>(&content_json).unwrap_or_else(|_| json!({"type":"doc","content":[]})), "contentMarkdown": row.get::<_, String>("content_markdown")?, "tags": tags_from_json(&tags), "createdAt": row.get::<_, String>("created_at")?, "updatedAt": row.get::<_, String>("updated_at")? }))
    }).map_err(|e| e.to_string())
}

fn list_templates(database: &Connection) -> Result<Value, String> {
    let mut statement = database.prepare("SELECT id, name, description, title, content_json, content_markdown, tags_json, created_at, updated_at FROM memo_templates ORDER BY updated_at DESC, name").map_err(|e| e.to_string())?;
    let rows = statement.query_map([], |row| {
        let content_json: String = row.get("content_json")?;
        let tags: String = row.get("tags_json")?;
        Ok(json!({ "id": row.get::<_, String>("id")?, "name": row.get::<_, String>("name")?, "description": row.get::<_, Option<String>>("description")?, "title": row.get::<_, Option<String>>("title")?, "contentJson": serde_json::from_str::<Value>(&content_json).unwrap_or_else(|_| json!({"type":"doc","content":[]})), "contentMarkdown": row.get::<_, String>("content_markdown")?, "tags": tags_from_json(&tags), "createdAt": row.get::<_, String>("created_at")?, "updatedAt": row.get::<_, String>("updated_at")? }))
    }).map_err(|e| e.to_string())?;
    let templates: Result<Vec<_>, _> = rows.collect();
    Ok(json!({ "templates": templates.map_err(|e| e.to_string())? }))
}

fn cache_template(database: &Connection, params: &Value) -> Result<Value, String> {
    let template = params
        .get("template")
        .ok_or_else(|| "Missing template payload".to_owned())?;
    let id = string_param(template, "id")?;
    let name = string_param(template, "name")?;
    let markdown = template
        .get("contentMarkdown")
        .and_then(Value::as_str)
        .unwrap_or("");
    let content_json = template
        .get("contentJson")
        .cloned()
        .unwrap_or_else(|| markdown_doc(markdown));
    let tags = template.get("tags").cloned().unwrap_or_else(|| json!([]));
    database.execute("INSERT INTO memo_templates (id, workspace_id, name, description, title, content_json, content_markdown, tags_json, created_at, updated_at) VALUES (?1, 'ws_default', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, title=excluded.title, content_json=excluded.content_json, content_markdown=excluded.content_markdown, tags_json=excluded.tags_json, updated_at=excluded.updated_at", rusqlite::params![id, name, template.get("description").and_then(Value::as_str), template.get("title").and_then(Value::as_str), content_json.to_string(), markdown, tags.to_string(), string_param(template, "createdAt")?, string_param(template, "updatedAt")?]).map_err(|e| e.to_string())?;
    template_value(database, &id).map(|template| json!({ "template": template }))
}

fn create_template(database: &Connection, params: &Value) -> Result<Value, String> {
    let name = string_param(params, "name")?;
    let id = now_id("tpl_local");
    let (title, markdown, tags, content_json) =
        if let Some(memo_id) = params.get("memoId").and_then(Value::as_str) {
            let memo = memo_value(database, memo_id, true)?;
            (
                memo.get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned(),
                memo.get("contentMarkdown")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned(),
                memo.get("tags").cloned().unwrap_or_else(|| json!([])),
                memo.get("contentJson")
                    .cloned()
                    .unwrap_or_else(|| markdown_doc("")),
            )
        } else {
            let markdown = params
                .get("contentMarkdown")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned();
            (
                params
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned(),
                markdown.clone(),
                params.get("tags").cloned().unwrap_or_else(|| json!([])),
                markdown_doc(&markdown),
            )
        };
    let description = params.get("description").and_then(Value::as_str);
    database.execute("INSERT INTO memo_templates (id, workspace_id, name, description, title, content_json, content_markdown, tags_json) VALUES (?1, 'ws_default', ?2, ?3, ?4, ?5, ?6, ?7)", rusqlite::params![id, name, description, if title.is_empty() { None } else { Some(title.clone()) }, content_json.to_string(), markdown, tags.to_string()]).map_err(|e| e.to_string())?;
    let template = template_value(database, &id)?;
    enqueue_change(
        database,
        "template.create",
        &id,
        &json!({
            "temporaryId": id, "name": name, "description": description,
            "title": if title.is_empty() { Value::Null } else { json!(title) },
            "contentMarkdown": markdown, "tags": tags,
        }),
    )?;
    Ok(template)
}

fn update_template(database: &Connection, params: &Value) -> Result<Value, String> {
    let template_id = string_param(params, "templateId")?;
    let current = template_value(database, &template_id)?;
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_else(|| current.get("name").and_then(Value::as_str).unwrap_or(""));
    let description = if params.get("description").is_some() {
        params.get("description").and_then(Value::as_str)
    } else {
        current.get("description").and_then(Value::as_str)
    };
    let title = if params.get("title").is_some() {
        params.get("title").and_then(Value::as_str)
    } else {
        current.get("title").and_then(Value::as_str)
    };
    let markdown = params
        .get("contentMarkdown")
        .and_then(Value::as_str)
        .unwrap_or_else(|| {
            current
                .get("contentMarkdown")
                .and_then(Value::as_str)
                .unwrap_or("")
        });
    let tags = params
        .get("tags")
        .cloned()
        .unwrap_or_else(|| current.get("tags").cloned().unwrap_or_else(|| json!([])));
    database.execute("UPDATE memo_templates SET name = ?1, description = ?2, title = ?3, content_json = ?4, content_markdown = ?5, tags_json = ?6, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?7", rusqlite::params![name, description, title, markdown_doc(markdown).to_string(), markdown, tags.to_string(), template_id]).map_err(|e| e.to_string())?;
    let template = template_value(database, &template_id)?;
    enqueue_change(database, "template.update", &template_id, params)?;
    Ok(template)
}

fn delete_template(database: &Connection, params: &Value) -> Result<Value, String> {
    let template_id = string_param(params, "templateId")?;
    database
        .execute("DELETE FROM memo_templates WHERE id = ?1", [&template_id])
        .map_err(|e| e.to_string())?;
    enqueue_change(database, "template.delete", &template_id, params)?;
    Ok(json!({ "ok": true }))
}

fn list_resources(database: &Connection, params: &Value) -> Result<Value, String> {
    let limit = params
        .get("limit")
        .and_then(Value::as_i64)
        .unwrap_or(500)
        .clamp(1, 500);
    let mut statement = database.prepare(
        "SELECT r.id, r.memo_id, r.original_memo_id, r.kind, r.mime_type, r.filename, r.byte_size, r.sha256, r.width, r.height, r.created_at, r.updated_at, m.title, m.excerpt, m.is_deleted
           FROM resources r INNER JOIN memos m ON m.id = r.memo_id
          WHERE r.is_deleted = 0 ORDER BY r.created_at DESC LIMIT ?1",
    ).map_err(|e| e.to_string())?;
    let rows = statement.query_map([limit], |row| Ok(json!({
        "id": row.get::<_, String>("id")?, "memoId": row.get::<_, String>("memo_id")?, "originalMemoId": row.get::<_, Option<String>>("original_memo_id")?,
        "kind": row.get::<_, String>("kind")?, "mimeType": row.get::<_, Option<String>>("mime_type")?, "filename": row.get::<_, Option<String>>("filename")?,
        "byteSize": row.get::<_, i64>("byte_size")?, "sha256": row.get::<_, Option<String>>("sha256")?, "width": row.get::<_, Option<i64>>("width")?, "height": row.get::<_, Option<i64>>("height")?,
        "createdAt": row.get::<_, String>("created_at")?, "updatedAt": row.get::<_, String>("updated_at")?, "url": format!("/api/v1/resources/{}/blob", row.get::<_, String>("id")?),
        "memoTitle": row.get::<_, Option<String>>("title")?, "memoExcerpt": row.get::<_, Option<String>>("excerpt")?, "memoDeleted": row.get::<_, i64>("is_deleted")? != 0
    }))).map_err(|e| e.to_string())?;
    let resources: Result<Vec<_>, _> = rows.collect();
    let stats = database.query_row("SELECT COUNT(*), COALESCE(SUM(byte_size), 0), COALESCE(SUM(CASE WHEN kind = 'image' THEN 1 ELSE 0 END), 0), COALESCE(SUM(CASE WHEN kind = 'attachment' THEN 1 ELSE 0 END), 0) FROM resources WHERE is_deleted = 0", [], |row| Ok(json!({ "totalCount": row.get::<_, i64>(0)?, "totalBytes": row.get::<_, i64>(1)?, "imageCount": row.get::<_, i64>(2)?, "attachmentCount": row.get::<_, i64>(3)? }))).map_err(|e| e.to_string())?;
    Ok(json!({ "resources": resources.map_err(|e| e.to_string())?, "summary": stats }))
}

fn cache_resource(database: &Connection, params: &Value) -> Result<Value, String> {
    let resource = params
        .get("resource")
        .ok_or_else(|| "Missing resource payload".to_owned())?;
    let id = string_param(resource, "id")?;
    let memo_id = string_param(resource, "memoId")?;
    database.execute("INSERT INTO resources (id, memo_id, original_memo_id, bucket_name, object_key, kind, mime_type, filename, byte_size, sha256, width, height, metadata_json) VALUES (?1, ?2, ?3, 'edgeever-resources', ?1, ?4, ?5, ?6, ?7, ?8, ?9, ?10, '{}') ON CONFLICT(id) DO UPDATE SET memo_id=excluded.memo_id, kind=excluded.kind, mime_type=excluded.mime_type, filename=excluded.filename, byte_size=excluded.byte_size, sha256=excluded.sha256, width=excluded.width, height=excluded.height, is_deleted=0, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')", rusqlite::params![id, memo_id, resource.get("originalMemoId").and_then(Value::as_str), string_param(resource, "kind")?, resource.get("mimeType").and_then(Value::as_str), resource.get("filename").and_then(Value::as_str), resource.get("byteSize").and_then(Value::as_i64).unwrap_or(0), resource.get("sha256").and_then(Value::as_str), resource.get("width").and_then(Value::as_i64), resource.get("height").and_then(Value::as_i64)]).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

fn delete_cached_resource(database: &Connection, params: &Value) -> Result<Value, String> {
    let resource_id = string_param(params, "resourceId")?;
    database
        .execute("DELETE FROM resources WHERE id = ?1", [&resource_id])
        .map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

fn list_tags(database: &Connection) -> Result<Value, String> {
    let mut statement = database.prepare(
        "SELECT trim(j.value) AS name, COUNT(DISTINCT m.id) AS memo_count, MAX(m.updated_at) AS updated_at
           FROM memos m, json_each(m.tags_json) j
          WHERE m.is_deleted = 0 AND trim(j.value) <> ''
          GROUP BY trim(j.value) ORDER BY name COLLATE NOCASE",
    ).map_err(|e| e.to_string())?;
    let rows = statement.query_map([], |row| Ok(json!({ "name": row.get::<_, String>("name")?, "memoCount": row.get::<_, i64>("memo_count")?, "updatedAt": row.get::<_, Option<String>>("updated_at")? }))).map_err(|e| e.to_string())?;
    let tags: Result<Vec<_>, _> = rows.collect();
    Ok(json!({ "tags": tags.map_err(|e| e.to_string())? }))
}

fn rewrite_tag(database: &Connection, params: &Value, delete: bool) -> Result<Value, String> {
    let tag = string_param(params, "tag")?;
    let replacement = params
        .get("name")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let mut statement = database
        .prepare("SELECT id, tags_json FROM memos WHERE is_deleted = 0")
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, String)> = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    let tx = database
        .unchecked_transaction()
        .map_err(|e| e.to_string())?;
    let mut updated = 0;
    for (memo_id, tags_json) in rows {
        let mut tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
        let mut changed = false;
        for value in &mut tags {
            if value == &tag {
                changed = true;
                if delete {
                    value.clear();
                } else if let Some(name) = replacement.as_ref() {
                    *value = name.clone();
                }
            }
        }
        tags.retain(|value| !value.is_empty());
        tags.sort();
        tags.dedup();
        if changed {
            tx.execute("UPDATE memos SET tags_json = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by = 'desktop' WHERE id = ?2", rusqlite::params![serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_owned()), memo_id]).map_err(|e| e.to_string())?;
            updated += 1;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    enqueue_change(
        database,
        if delete { "tag.delete" } else { "tag.rename" },
        &tag,
        params,
    )?;
    Ok(json!({ "ok": true, "updated": updated }))
}

fn move_memos(database: &Connection, params: &Value) -> Result<Value, String> {
    let notebook_id = string_param(params, "notebookId")?;
    let memo_ids = params
        .get("memoIds")
        .and_then(Value::as_array)
        .ok_or_else(|| "Missing memoIds array".to_owned())?;
    if memo_ids.is_empty() {
        return Ok(json!({ "ok": true, "moved": 0 }));
    }
    let exists: bool = database
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM notebooks WHERE id = ?1 AND is_deleted = 0)",
            [&notebook_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !exists {
        return Err(format!("Notebook not found: {notebook_id}"));
    }
    let tx = database
        .unchecked_transaction()
        .map_err(|e| e.to_string())?;
    let mut moved = 0;
    for memo_id in memo_ids {
        if let Some(id) = memo_id.as_str() {
            moved += tx.execute("UPDATE memos SET notebook_id = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by = 'desktop' WHERE id = ?2 AND is_deleted = 0", rusqlite::params![notebook_id, id]).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    enqueue_change(database, "memo.move", &notebook_id, params)?;
    Ok(json!({ "ok": true, "moved": moved }))
}

fn delete_memos(database: &Connection, params: &Value) -> Result<Value, String> {
    let memo_ids = params
        .get("memoIds")
        .and_then(Value::as_array)
        .ok_or_else(|| "Missing memoIds array".to_owned())?;
    let permanent = bool_param(params, "permanent", false);
    if memo_ids.is_empty() {
        return Ok(json!({ "ok": true, "deleted": 0 }));
    }
    let tx = database
        .unchecked_transaction()
        .map_err(|e| e.to_string())?;
    let mut deleted = 0;
    for memo_id in memo_ids {
        let Some(id) = memo_id.as_str() else { continue };
        if permanent {
            tx.execute("DELETE FROM resources WHERE memo_id = ?1", [id])
                .map_err(|e| e.to_string())?;
            deleted += tx
                .execute("DELETE FROM memos WHERE id = ?1 AND is_deleted = 1", [id])
                .map_err(|e| e.to_string())?;
        } else {
            deleted += tx.execute("UPDATE memos SET is_deleted = 1, deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1 AND is_deleted = 0", [id]).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    enqueue_change(database, "memo.deleteBatch", "batch", params)?;
    Ok(json!({ "ok": true, "deleted": deleted }))
}

fn empty_trash(database: &Connection) -> Result<Value, String> {
    let tx = database
        .unchecked_transaction()
        .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM resources WHERE memo_id IN (SELECT id FROM memos WHERE is_deleted = 1)",
        [],
    )
    .map_err(|e| e.to_string())?;
    let deleted = tx
        .execute("DELETE FROM memos WHERE is_deleted = 1", [])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    enqueue_change(database, "memo.emptyTrash", "trash", &json!({}))?;
    Ok(json!({ "ok": true, "deleted": deleted }))
}

fn pin_memos(database: &Connection, params: &Value) -> Result<Value, String> {
    let memo_ids = params
        .get("memoIds")
        .and_then(Value::as_array)
        .ok_or_else(|| "Missing memoIds array".to_owned())?;
    let is_pinned = bool_param(params, "isPinned", false);
    let tx = database
        .unchecked_transaction()
        .map_err(|e| e.to_string())?;
    let mut updated = 0;
    for memo_id in memo_ids {
        if let Some(id) = memo_id.as_str() {
            updated += tx.execute("UPDATE memos SET is_pinned = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by = 'desktop' WHERE id = ?2 AND is_deleted = 0", rusqlite::params![is_pinned as i64, id]).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    enqueue_change(database, "memo.pinBatch", "batch", params)?;
    Ok(json!({ "ok": true, "updated": updated }))
}

fn merge_memos(database: &Connection, params: &Value) -> Result<Value, String> {
    let memo_ids = params
        .get("memoIds")
        .and_then(Value::as_array)
        .ok_or_else(|| "Missing memoIds array".to_owned())?;
    let ids: Vec<String> = memo_ids
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect();
    if ids.len() < 2 {
        return Err("At least two memos are required to merge".to_owned());
    }
    let target_notebook = params
        .get("notebookId")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let mut first_notebook_id: Option<String> = None;
    let mut titles = Vec::new();
    let mut markdowns = Vec::new();
    let mut tags = Vec::<String>::new();
    for id in &ids {
        let row = database.query_row("SELECT m.title, m.notebook_id, c.content_markdown, m.tags_json, c.content_text, c.content_json FROM memos m JOIN memo_contents c ON c.memo_id = m.id WHERE m.id = ?1 AND m.is_deleted = 0", [id], |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?, row.get::<_, String>(4)?, row.get::<_, String>(5)?))).map_err(|e| e.to_string())?;
        if first_notebook_id.is_none() {
            first_notebook_id = Some(row.1);
        }
        if let Some(title) = row.0 {
            if !title.trim().is_empty() {
                titles.push(title);
            }
        }
        markdowns.push(resolve_sidecar_merge_markdown(&row.2, &row.4, &row.5)?);
        let memo_tags: Vec<String> = serde_json::from_str(&row.3).unwrap_or_default();
        tags.extend(memo_tags);
    }
    let notebook_id = target_notebook.or(first_notebook_id).unwrap_or_default();
    if notebook_id.is_empty() {
        return Err("Target notebook not found".to_owned());
    }
    let title = params
        .get("title")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.trim().to_owned())
        .or_else(|| resolve_custom_merge_title(titles.iter().map(String::as_str)))
        .unwrap_or_default();
    tags.sort();
    tags.dedup();
    let markdown = markdowns.join("\n\n---\n\n");
    let content_json = markdown_doc(&markdown);
    let content_json_text = content_json.to_string();
    let content_text = markdown.lines().collect::<Vec<_>>().join(" ");
    let id = now_id("memo_local");
    let source_ids = serde_json::to_string(&ids).unwrap_or_else(|_| "[]".to_owned());
    let tx = database
        .unchecked_transaction()
        .map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO memos (id, notebook_id, title, excerpt, tags_json, source_memo_ids, merge_source_count, created_by, updated_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'desktop', 'desktop')", rusqlite::params![id, notebook_id, if title.is_empty() { None } else { Some(title.clone()) }, content_text.chars().take(180).collect::<String>(), serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_owned()), source_ids, ids.len() as i64]).map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO memo_contents (memo_id, content_json, content_markdown, content_text, content_hash) VALUES (?1, ?2, ?3, ?4, ?5)", rusqlite::params![id, content_json_text, markdown, content_text, content_hash(&markdown, &content_json_text)]).map_err(|e| e.to_string())?;
    for source_id in &ids {
        tx.execute("UPDATE memos SET is_deleted = 1, deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), merged_into_memo_id = ?1, merged_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?2", rusqlite::params![id, source_id]).map_err(|e| e.to_string())?;
        tx.execute("UPDATE resources SET original_memo_id = COALESCE(original_memo_id, memo_id), memo_id = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE memo_id = ?2", rusqlite::params![id, source_id]).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    enqueue_change(
        database,
        "memo.merge",
        &id,
        &json!({ "memoIds": ids, "notebookId": notebook_id, "title": title, "temporaryId": id }),
    )?;
    memo_value(database, &id, true).map(|memo| json!({ "memo": memo }))
}

fn resolve_custom_merge_title<'a>(titles: impl IntoIterator<Item = &'a str>) -> Option<String> {
    titles
        .into_iter()
        .map(str::trim)
        .find(|title| !title.is_empty() && *title != "无标题笔记")
        .map(str::to_owned)
}

fn resolve_sidecar_merge_markdown(
    markdown: &str,
    content_text: &str,
    content_json: &str,
) -> Result<String, String> {
    if !markdown.trim().is_empty() {
        return Ok(markdown.to_owned());
    }

    if !content_text.trim().is_empty() {
        return Ok(content_text.to_owned());
    }

    let content: Value = serde_json::from_str(content_json).unwrap_or(Value::Null);
    if sidecar_doc_has_non_text_content(&content) {
        return Err(
            "Source note content could not be recovered safely. Merge was cancelled.".to_owned(),
        );
    }

    Ok(String::new())
}

fn sidecar_doc_has_non_text_content(value: &Value) -> bool {
    let node_type = value.get("type").and_then(Value::as_str).unwrap_or("");
    if matches!(
        node_type,
        "image"
            | "table"
            | "codeBlock"
            | "bulletList"
            | "orderedList"
            | "blockquote"
            | "horizontalRule"
            | "edgeeverThemeBlock"
    ) {
        return true;
    }

    value
        .get("content")
        .and_then(Value::as_array)
        .is_some_and(|children| children.iter().any(sidecar_doc_has_non_text_content))
}

fn list_memos(database: &Connection, params: &Value) -> Result<Value, String> {
    let trash = bool_param(params, "trash", false);
    let q = params
        .get("q")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_owned();
    let notebook_ids = params
        .get("notebookIds")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    // A notebookIds collection represents the complete notebook subtree and
    // therefore supersedes the singular notebookId. Applying both filters
    // would reduce the subtree back to the parent notebook alone.
    let notebook_id = if notebook_ids.is_empty() {
        params.get("notebookId").and_then(Value::as_str)
    } else {
        None
    };
    let notebook_ids_json = Value::Array(notebook_ids).to_string();
    let filter = match params.get("filter").and_then(Value::as_str) {
        Some("pinned") => " AND m.is_pinned = 1",
        Some("tagged") => " AND json_array_length(m.tags_json) > 0",
        Some("untagged") => " AND json_array_length(m.tags_json) = 0",
        _ => "",
    };
    let order = match params.get("sort").and_then(Value::as_str) {
        Some("created-desc") => "m.created_at DESC, m.id DESC",
        Some("title-asc") => {
            "COALESCE(m.title, m.excerpt) COLLATE NOCASE ASC, m.updated_at DESC, m.id DESC"
        }
        _ if trash => "m.deleted_at DESC, m.id DESC",
        _ => "m.is_pinned DESC, m.updated_at DESC, m.id DESC",
    };
    let limit = params
        .get("limit")
        .and_then(Value::as_i64)
        .unwrap_or(50)
        .clamp(1, 200);
    let offset = params
        .get("offset")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        .max(0);
    let query = format!("SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned, m.is_archived, m.is_deleted,
                c.revision, m.created_at, m.updated_at, m.deleted_at
           FROM memos m JOIN memo_contents c ON c.memo_id = m.id
          WHERE m.is_deleted = ?1 AND (?2 = '' OR lower(COALESCE(m.title, '') || ' ' || m.excerpt || ' ' || c.content_text || ' ' || m.tags_json) LIKE '%' || lower(?2) || '%')
            AND (?3 IS NULL OR m.notebook_id = ?3)
            AND (?4 = '[]' OR m.notebook_id IN (SELECT value FROM json_each(?4))){}
          ORDER BY {} LIMIT ?5 OFFSET ?6", filter, order);
    let mut statement = database.prepare(&query).map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(
            rusqlite::params![
                trash as i64,
                q,
                notebook_id,
                notebook_ids_json,
                limit,
                offset
            ],
            summary_from_row,
        )
        .map_err(|e| e.to_string())?;
    let memos: Result<Vec<_>, _> = rows.collect();
    let count_query = format!("SELECT COUNT(*) FROM memos m JOIN memo_contents c ON c.memo_id = m.id WHERE m.is_deleted = ?1 AND (?2 = '' OR lower(COALESCE(m.title, '') || ' ' || m.excerpt || ' ' || c.content_text || ' ' || m.tags_json) LIKE '%' || lower(?2) || '%') AND (?3 IS NULL OR m.notebook_id = ?3) AND (?4 = '[]' OR m.notebook_id IN (SELECT value FROM json_each(?4))){}", filter);
    let total: i64 = database
        .query_row(
            &count_query,
            rusqlite::params![trash as i64, q, notebook_id, notebook_ids_json],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let memos = memos.map_err(|e| e.to_string())?;
    let next_cursor = if offset + (memos.len() as i64) < total {
        Some((offset + memos.len() as i64).to_string())
    } else {
        None
    };
    Ok(json!({ "memos": memos, "totalCount": total, "nextCursor": next_cursor }))
}

fn create_memo(database: &Connection, params: &Value) -> Result<Value, String> {
    let notebook_id = string_param(params, "notebookId")?;
    let title = params
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_owned();
    let markdown = params
        .get("contentMarkdown")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let tags = params.get("tags").cloned().unwrap_or_else(|| json!([]));
    let content_json = params
        .get("contentJson")
        .cloned()
        .unwrap_or_else(|| markdown_doc(&markdown));
    let content_json_text = content_json.to_string();
    let text = markdown.lines().collect::<Vec<_>>().join(" ");
    let id = now_id("memo_local");
    let hash = content_hash(&markdown, &content_json_text);
    let tx = database
        .unchecked_transaction()
        .map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO memos (id, notebook_id, title, excerpt, tags_json, created_by, updated_by) VALUES (?1, ?2, ?3, ?4, ?5, 'desktop', 'desktop')", rusqlite::params![id, notebook_id, if title.is_empty() { None } else { Some(title.clone()) }, text.chars().take(180).collect::<String>(), tags.to_string()]).map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO memo_contents (memo_id, content_json, content_markdown, content_text, content_hash) VALUES (?1, ?2, ?3, ?4, ?5)", rusqlite::params![id, content_json_text, markdown, text, hash]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    let memo = memo_value(database, &id, true)?;
    enqueue_change(
        database,
        "memo.create",
        &id,
        &json!({
            "temporaryId": id, "notebookId": notebook_id, "title": title, "contentMarkdown": markdown,
            "tags": tags, "createdAt": memo.get("createdAt").and_then(Value::as_str).unwrap_or(""),
            "updatedAt": memo.get("updatedAt").and_then(Value::as_str).unwrap_or("")
        }),
    )?;
    Ok(memo)
}

fn update_memo(database: &Connection, params: &Value) -> Result<Value, String> {
    let memo_id = string_param(params, "memoId")?;
    let previous = memo_value(database, &memo_id, true)?;
    let requested_revision = params
        .get("expectedRevision")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let requested_content_hash = params
        .get("expectedContentHash")
        .and_then(Value::as_str)
        .unwrap_or("");
    // A freshly-created desktop note changes from its local id/revision 0 to
    // the server id/revision while the editor is still live. If an autosave
    // was already scheduled, translate that one known local base to the exact
    // create acknowledgement instead of misclassifying our own create as a
    // remote edit. The marker retains both sides of the mapping, so a genuine
    // later remote revision still conflicts normally.
    let (expected_revision, expected_content_hash, consumed_remap_base) =
        resolve_remapped_memo_base(
            database,
            &memo_id,
            requested_revision,
            requested_content_hash,
        );
    let title = params
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_owned();
    let content_json = params.get("contentJson").cloned().unwrap_or_else(|| {
        markdown_doc(
            params
                .get("contentMarkdown")
                .and_then(Value::as_str)
                .unwrap_or(""),
        )
    });
    let content_json_text = content_json.to_string();
    let markdown = params
        .get("contentMarkdown")
        .and_then(Value::as_str)
        .or_else(|| previous.get("contentMarkdown").and_then(Value::as_str))
        .unwrap_or("")
        .to_owned();
    let text = params
        .get("contentText")
        .and_then(Value::as_str)
        .unwrap_or(&markdown)
        .to_owned();
    let tags = params.get("tags").cloned().unwrap_or_else(|| json!([]));
    let hash = content_hash(&markdown, &content_json_text);
    let tx = database
        .unchecked_transaction()
        .map_err(|e| e.to_string())?;
    insert_revision(&tx, &previous, "desktop")?;
    let changed = tx.execute("UPDATE memos SET title = ?2, excerpt = ?3, tags_json = ?4, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by = 'desktop' WHERE id = ?1 AND is_deleted = 0", rusqlite::params![memo_id, if title.is_empty() { None } else { Some(title) }, text.chars().take(180).collect::<String>(), tags.to_string()]).map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err(format!("Memo not found or deleted: {memo_id}"));
    }
    // `revision` is the last acknowledged cloud revision, not a counter for
    // local autosaves. Advancing it here makes several saves on one device
    // look newer than the cloud and produces a false revision conflict once
    // the coalesced outbox item is synced.
    tx.execute("UPDATE memo_contents SET content_json = ?2, content_markdown = ?3, content_text = ?4, content_hash = ?5, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE memo_id = ?1", rusqlite::params![memo_id, content_json_text, markdown, text, hash]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    enqueue_change(
        database,
        "memo.update",
        &memo_id,
        &json!({
            "memoId": memo_id, "expectedRevision": expected_revision,
            "expectedContentHash": expected_content_hash,
            "title": params.get("title").and_then(Value::as_str).unwrap_or(""), "contentJson": content_json,
            "contentMarkdown": markdown, "tags": tags
        }),
    )?;
    if consumed_remap_base {
        database
            .execute(
                "DELETE FROM _edgeever_sidecar_meta WHERE key = ?1",
                [memo_remap_base_key(&memo_id)],
            )
            .map_err(|e| e.to_string())?;
    }
    memo_value(database, &memo_id, true)
}

fn delete_memo(database: &Connection, params: &Value) -> Result<Value, String> {
    let memo_id = string_param(params, "memoId")?;
    if bool_param(params, "permanent", false) {
        database
            .execute("DELETE FROM memos WHERE id = ?1", [&memo_id])
            .map_err(|e| e.to_string())?;
    } else {
        database.execute("UPDATE memos SET is_deleted = 1, deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1", [&memo_id]).map_err(|e| e.to_string())?;
    }
    enqueue_change(
        database,
        "memo.delete",
        &memo_id,
        &json!({ "memoId": memo_id, "permanent": bool_param(params, "permanent", false) }),
    )?;
    Ok(json!({ "ok": true }))
}

fn restore_memo(database: &Connection, params: &Value) -> Result<Value, String> {
    let memo_id = string_param(params, "memoId")?;
    let changed = database.execute("UPDATE memos SET is_deleted = 0, deleted_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1", [&memo_id]).map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err(format!("Memo not found: {memo_id}"));
    }
    enqueue_change(
        database,
        "memo.restore",
        &memo_id,
        &json!({ "memoId": memo_id }),
    )?;
    memo_value(database, &memo_id, true)
}

fn restore_memo_revision(database: &Connection, params: &Value) -> Result<Value, String> {
    let memo_id = string_param(params, "memoId")?;
    let revision_id = string_param(params, "revisionId")?;
    let current = memo_value(database, &memo_id, true)?;
    let revision = revision_value(database, &memo_id, &revision_id)?;
    let title = revision
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_owned();
    let content_json = revision
        .get("contentJson")
        .cloned()
        .unwrap_or_else(|| json!({"type":"doc","content":[]}));
    let content_json_text = content_json.to_string();
    let markdown = revision
        .get("contentMarkdown")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let text = revision
        .get("contentText")
        .and_then(Value::as_str)
        .unwrap_or(&markdown)
        .to_owned();
    let tags = revision.get("tags").cloned().unwrap_or_else(|| json!([]));
    let hash = content_hash(&markdown, &content_json_text);
    let next_revision = current.get("revision").and_then(Value::as_i64).unwrap_or(0) + 1;
    let tx = database
        .unchecked_transaction()
        .map_err(|e| e.to_string())?;
    insert_revision(&tx, &current, "desktop")?;
    tx.execute("UPDATE memos SET title = ?2, excerpt = ?3, tags_json = ?4, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by = 'desktop' WHERE id = ?1", rusqlite::params![memo_id, if title.is_empty() { None } else { Some(title.clone()) }, text.chars().take(180).collect::<String>(), tags.to_string()]).map_err(|e| e.to_string())?;
    tx.execute("UPDATE memo_contents SET content_json = ?2, content_markdown = ?3, content_text = ?4, content_hash = ?5, revision = ?6, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE memo_id = ?1", rusqlite::params![memo_id, content_json_text, markdown, text, hash, next_revision]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    enqueue_change(
        database,
        "memo.update",
        &memo_id,
        &json!({
            "memoId": memo_id, "expectedRevision": current.get("revision").and_then(Value::as_i64).unwrap_or(0),
            "expectedContentHash": current.get("contentHash").and_then(Value::as_str).unwrap_or(""),
            "title": title, "contentJson": content_json, "contentMarkdown": markdown, "tags": tags,
        }),
    )?;
    memo_value(database, &memo_id, true).map(|memo| json!({ "memo": memo }))
}

fn sync_status(database: &Connection) -> Result<Value, String> {
    let count = |status: &str| -> Result<i64, String> {
        database
            .query_row(
                "SELECT COUNT(*) FROM _edgeever_sidecar_outbox WHERE status = ?1",
                [status],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())
    };
    Ok(json!({
        "pending": count("pending")?, "syncing": count("syncing")?, "conflict": count("conflict")?, "error": count("error")?,
        "cursor": meta_value(database, "sync.cursor").and_then(|v| v.parse::<i64>().ok()).unwrap_or(0),
        "syncIdentity": meta_value(database, "sync.identity"), "lastSyncedAt": meta_value(database, "sync.last_synced_at")
    }))
}

const SYNC_BOOTSTRAP_RESET_KEY: &str = "sync.bootstrap.reset_pending";

fn reset_sync_mirror(database: &Connection) -> Result<(), String> {
    let tx = database
        .unchecked_transaction()
        .map_err(|e| e.to_string())?;
    tx.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS _edgeever_bootstrap_preserved_memos (id TEXT PRIMARY KEY);
         CREATE TEMP TABLE IF NOT EXISTS _edgeever_bootstrap_preserved_notebooks (id TEXT PRIMARY KEY);
         DELETE FROM _edgeever_bootstrap_preserved_memos;
         DELETE FROM _edgeever_bootstrap_preserved_notebooks;
         INSERT OR IGNORE INTO _edgeever_bootstrap_preserved_memos (id)
         SELECT m.id FROM memos m
         WHERE EXISTS (
           SELECT 1 FROM _edgeever_sidecar_outbox o
           WHERE o.entity_id = m.id OR instr(o.payload_json, m.id) > 0
         );
         INSERT OR IGNORE INTO _edgeever_bootstrap_preserved_notebooks (id)
         SELECT n.id FROM notebooks n
         WHERE EXISTS (
           SELECT 1 FROM _edgeever_sidecar_outbox o
           WHERE o.entity_id = n.id OR instr(o.payload_json, n.id) > 0
         );
         INSERT OR IGNORE INTO _edgeever_bootstrap_preserved_notebooks (id)
         SELECT DISTINCT m.notebook_id
         FROM memos m
         INNER JOIN _edgeever_bootstrap_preserved_memos p ON p.id = m.id;
         WITH RECURSIVE preserved_ancestors(id, parent_id) AS (
           SELECT n.id, n.parent_id
           FROM notebooks n
           INNER JOIN _edgeever_bootstrap_preserved_notebooks p ON p.id = n.id
           UNION
           SELECT parent.id, parent.parent_id
           FROM notebooks parent
           INNER JOIN preserved_ancestors child ON child.parent_id = parent.id
         )
         INSERT OR IGNORE INTO _edgeever_bootstrap_preserved_notebooks (id)
         SELECT id FROM preserved_ancestors;
         DELETE FROM resources
         WHERE memo_id NOT IN (SELECT id FROM _edgeever_bootstrap_preserved_memos);
         DELETE FROM memos
         WHERE id NOT IN (SELECT id FROM _edgeever_bootstrap_preserved_memos);
         UPDATE notebooks SET parent_id = NULL
         WHERE id NOT IN (SELECT id FROM _edgeever_bootstrap_preserved_notebooks);
         DELETE FROM notebooks
         WHERE id NOT IN (SELECT id FROM _edgeever_bootstrap_preserved_notebooks);
         DELETE FROM _edgeever_sidecar_meta
         WHERE key IN ('sync.cursor', 'sync.identity', 'sync.last_synced_at')
            OR key LIKE 'memo.remap-base:%';
         INSERT INTO _edgeever_sidecar_meta (key, value, updated_at)
         VALUES ('sync.bootstrap.reset_pending', '1', strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;",
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

fn prepare_sync_bootstrap(database: &Connection, params: &Value) -> Result<Value, String> {
    let reset_requested = bool_param(params, "reset", false)
        || meta_value(database, SYNC_BOOTSTRAP_RESET_KEY).as_deref() == Some("1");
    if reset_requested {
        reset_sync_mirror(database)?;
        return Ok(json!({ "clearedSeedData": false, "rebuiltMirror": true }));
    }

    if meta_value(database, "sync.identity").is_some_and(|identity| !identity.is_empty()) {
        return Ok(json!({ "clearedSeedData": false, "rebuiltMirror": false }));
    }

    let outbox_count = database
        .query_row("SELECT COUNT(*) FROM _edgeever_sidecar_outbox", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|e| e.to_string())?;
    let non_seed_memos = database
        .query_row(
            "SELECT COUNT(*) FROM memos WHERE id <> 'memo_welcome'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?;
    let non_seed_notebooks = database
        .query_row(
            "SELECT COUNT(*) FROM notebooks
             WHERE id NOT IN ('nb_inbox', 'nb_projects', 'nb_learning', 'nb_creative', 'nb_personal')",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?;

    if outbox_count > 0 || non_seed_memos > 0 || non_seed_notebooks > 0 {
        return Ok(json!({ "clearedSeedData": false, "rebuiltMirror": false }));
    }

    let tx = database
        .unchecked_transaction()
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM memos WHERE id = 'memo_welcome'", [])
        .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM notebooks
         WHERE id IN ('nb_inbox', 'nb_projects', 'nb_learning', 'nb_creative', 'nb_personal')",
        [],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(json!({ "clearedSeedData": true, "rebuiltMirror": false }))
}

fn sync_outbox_list(database: &Connection, params: &Value) -> Result<Value, String> {
    let limit = params
        .get("limit")
        .and_then(Value::as_i64)
        .unwrap_or(50)
        .clamp(1, 200);
    let include_conflicts = bool_param(params, "includeConflicts", false);
    let sql = if include_conflicts {
        "SELECT id, kind, entity_id, payload_json, attempt_count, status, last_error, version, last_error_code, retryable, next_attempt_at, created_at, updated_at FROM _edgeever_sidecar_outbox WHERE status IN ('pending', 'error', 'conflict') ORDER BY id LIMIT ?1"
    } else {
        "SELECT id, kind, entity_id, payload_json, attempt_count, status, last_error, version, last_error_code, retryable, next_attempt_at, created_at, updated_at FROM _edgeever_sidecar_outbox WHERE status = 'pending' OR (status = 'error' AND retryable = 1 AND (next_attempt_at IS NULL OR next_attempt_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))) ORDER BY id LIMIT ?1"
    };
    let mut statement = database.prepare(sql).map_err(|e| e.to_string())?;
    let rows = statement.query_map([limit], |row| {
        let payload: String = row.get(3)?;
        Ok(json!({ "id": row.get::<_, i64>(0)?, "kind": row.get::<_, String>(1)?, "entityId": row.get::<_, String>(2)?, "payload": serde_json::from_str::<Value>(&payload).unwrap_or_else(|_| json!({})), "attemptCount": row.get::<_, i64>(4)?, "status": row.get::<_, String>(5)?, "lastError": row.get::<_, Option<String>>(6)?, "version": row.get::<_, i64>(7)?, "lastErrorCode": row.get::<_, Option<String>>(8)?, "retryable": row.get::<_, bool>(9)?, "nextAttemptAt": row.get::<_, Option<String>>(10)?, "createdAt": row.get::<_, String>(11)?, "updatedAt": row.get::<_, String>(12)? }))
    }).map_err(|e| e.to_string())?;
    let items: Result<Vec<_>, _> = rows.collect();
    Ok(json!({ "items": items.map_err(|e| e.to_string())? }))
}

fn sync_outbox_ack(database: &Connection, params: &Value) -> Result<Value, String> {
    let id = params
        .get("id")
        .and_then(Value::as_i64)
        .ok_or_else(|| "Missing outbox id".to_owned())?;
    let (kind, entity_id, current_version): (String, String, i64) = database
        .query_row(
            "SELECT kind, entity_id, version FROM _edgeever_sidecar_outbox WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| e.to_string())?;
    let requested_version = params.get("version").and_then(Value::as_i64);
    let superseded = requested_version.is_some_and(|version| version != current_version);
    let remote_memo = params.get("remoteMemo").cloned();
    let remote_notebook = params.get("remoteNotebook").cloned();
    let remote_template = params.get("remoteTemplate").cloned();
    let temporary_memo_base = if kind == "memo.create" {
        memo_value(database, &entity_id, true).ok().map(|memo| {
            (
                memo.get("revision").and_then(Value::as_i64).unwrap_or(0),
                memo.get("contentHash")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned(),
            )
        })
    } else {
        None
    };

    if kind == "memo.update" && superseded {
        if let Some(remote) = remote_memo.as_ref() {
            let remote_revision = remote.get("revision").and_then(Value::as_i64).unwrap_or(0);
            let remote_hash = remote
                .get("contentHash")
                .and_then(Value::as_str)
                .unwrap_or("");
            let payload_text: String = database
                .query_row(
                    "SELECT payload_json FROM _edgeever_sidecar_outbox WHERE id = ?1",
                    [id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            let mut payload: Value =
                serde_json::from_str(&payload_text).unwrap_or_else(|_| json!({}));
            payload["expectedRevision"] = json!(remote_revision);
            payload["expectedContentHash"] = json!(remote_hash);
            let tx = database
                .unchecked_transaction()
                .map_err(|e| e.to_string())?;
            // Preserve the successor draft's content while advancing only its
            // acknowledged cloud base. The next flush will send that draft on
            // top of the response that just succeeded.
            tx.execute(
                "UPDATE memo_contents SET revision = ?1 WHERE memo_id = ?2",
                rusqlite::params![remote_revision, entity_id],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "UPDATE _edgeever_sidecar_outbox
                 SET payload_json = ?1, status = 'pending', last_error = NULL,
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
                 WHERE id = ?2",
                rusqlite::params![payload.to_string(), id],
            )
            .map_err(|e| e.to_string())?;
            tx.commit().map_err(|e| e.to_string())?;
        }
        return Ok(json!({
            "ok": true,
            "superseded": true,
            "memo": remote_memo,
            "notebook": remote_notebook,
            "template": remote_template
        }));
    }

    if let Some(remote) = remote_memo.as_ref() {
        let remote_id = string_param(remote, "id")?;
        apply_sync_changes(
            database,
            &json!({
                "changes": [{
                    "entityType": "memo",
                    "operation": "upsert",
                    "entityId": remote_id,
                    "memo": remote,
                    "notebook": null
                }]
            }),
        )?;
    }
    if kind == "memo.create" || kind == "memo.merge" {
        if let Some(remote) = remote_memo.as_ref() {
            let remote_id = string_param(remote, "id")?;
            let remote_exists: bool = database
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM memos WHERE id = ?1)",
                    [&remote_id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            if remote_exists {
                // The acknowledgement caches the remote memo before reconciling
                // the local placeholder, so the remote id exists here.
                // A merged local memo can still own resources moved from its
                // sources. Deleting it directly is rejected by the resources
                // foreign key and leaves both the local placeholder and remote
                // memo visible forever. Repoint every surviving relationship
                // before removing the placeholder, and keep the reconciliation
                // atomic so a crash cannot strand a partially remapped merge.
                let tx = database
                    .unchecked_transaction()
                    .map_err(|e| e.to_string())?;
                tx.execute(
                    "UPDATE resources SET memo_id = ?1 WHERE memo_id = ?2",
                    rusqlite::params![remote_id, entity_id],
                )
                .map_err(|e| e.to_string())?;
                tx.execute(
                    "UPDATE resources SET original_memo_id = ?1 WHERE original_memo_id = ?2",
                    rusqlite::params![remote_id, entity_id],
                )
                .map_err(|e| e.to_string())?;
                tx.execute(
                    "UPDATE memos SET merged_into_memo_id = ?1 WHERE merged_into_memo_id = ?2",
                    rusqlite::params![remote_id, entity_id],
                )
                .map_err(|e| e.to_string())?;
                tx.execute("DELETE FROM memos WHERE id = ?1", [&entity_id])
                    .map_err(|e| e.to_string())?;
                tx.commit().map_err(|e| e.to_string())?;
            } else {
                database
                    .execute(
                        "UPDATE memos SET id = ?1 WHERE id = ?2",
                        rusqlite::params![remote_id, entity_id],
                    )
                    .map_err(|e| e.to_string())?;
            }
            let mut pending = database.prepare("SELECT id, entity_id, payload_json FROM _edgeever_sidecar_outbox WHERE id <> ?1").map_err(|e| e.to_string())?;
            let rows: Vec<(i64, String, String)> = pending
                .query_map([id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .map_err(|e| e.to_string())?
                .collect::<Result<_, _>>()
                .map_err(|e| e.to_string())?;
            for (outbox_id, outbox_entity, payload_text) in rows {
                if outbox_entity != entity_id && !payload_text.contains(&entity_id) {
                    continue;
                }
                let mut payload: Value =
                    serde_json::from_str(&payload_text).unwrap_or_else(|_| json!({}));
                if payload.get("memoId").and_then(Value::as_str) == Some(entity_id.as_str()) {
                    payload["memoId"] = json!(remote_id);
                }
                if payload.get("temporaryId").and_then(Value::as_str) == Some(entity_id.as_str()) {
                    payload["temporaryId"] = json!(remote_id);
                }
                if payload.get("memoId").and_then(Value::as_str) == Some(remote_id.as_str()) {
                    if let Some(revision) = remote.get("revision") {
                        payload["expectedRevision"] = revision.clone();
                    }
                    if let Some(hash) = remote.get("contentHash") {
                        payload["expectedContentHash"] = hash.clone();
                    }
                }
                let next_entity = if outbox_entity == entity_id {
                    remote_id.clone()
                } else {
                    outbox_entity
                };
                database.execute("UPDATE _edgeever_sidecar_outbox SET entity_id = ?1, payload_json = ?2, version = version + 1 WHERE id = ?3", rusqlite::params![next_entity, payload.to_string(), outbox_id]).map_err(|e| e.to_string())?;
            }
            if kind == "memo.create" {
                if let Some((temporary_revision, temporary_content_hash)) =
                    temporary_memo_base.as_ref()
                {
                    set_meta(
                        database,
                        &memo_remap_base_key(&remote_id),
                        &json!({
                            "temporaryRevision": temporary_revision,
                            "temporaryContentHash": temporary_content_hash,
                            "remoteRevision": remote.get("revision").and_then(Value::as_i64).unwrap_or(0),
                            "remoteContentHash": remote.get("contentHash").and_then(Value::as_str).unwrap_or("")
                        })
                        .to_string(),
                    )?;
                }
            }
        }
    }
    if kind == "notebook.create" {
        if let Some(remote) = remote_notebook.as_ref() {
            let remote_id = string_param(remote, "id")?;
            let remote_exists: bool = database
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM notebooks WHERE id = ?1)",
                    [&remote_id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            if remote_exists {
                database
                    .execute("DELETE FROM notebooks WHERE id = ?1", [&entity_id])
                    .map_err(|e| e.to_string())?;
            } else {
                database
                    .execute(
                        "UPDATE notebooks SET id = ?1 WHERE id = ?2",
                        rusqlite::params![remote_id, entity_id],
                    )
                    .map_err(|e| e.to_string())?;
            }
            let mut pending = database.prepare("SELECT id, entity_id, payload_json FROM _edgeever_sidecar_outbox WHERE id <> ?1").map_err(|e| e.to_string())?;
            let rows: Vec<(i64, String, String)> = pending
                .query_map([id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .map_err(|e| e.to_string())?
                .collect::<Result<_, _>>()
                .map_err(|e| e.to_string())?;
            for (outbox_id, outbox_entity, payload_text) in rows {
                if outbox_entity != entity_id && !payload_text.contains(&entity_id) {
                    continue;
                }
                let mut payload: Value =
                    serde_json::from_str(&payload_text).unwrap_or_else(|_| json!({}));
                if payload.get("notebookId").and_then(Value::as_str) == Some(entity_id.as_str()) {
                    payload["notebookId"] = json!(remote_id);
                }
                if payload.get("temporaryId").and_then(Value::as_str) == Some(entity_id.as_str()) {
                    payload["temporaryId"] = json!(remote_id);
                }
                let next_entity = if outbox_entity == entity_id {
                    remote_id.clone()
                } else {
                    outbox_entity
                };
                database.execute("UPDATE _edgeever_sidecar_outbox SET entity_id = ?1, payload_json = ?2, version = version + 1 WHERE id = ?3", rusqlite::params![next_entity, payload.to_string(), outbox_id]).map_err(|e| e.to_string())?;
            }
        }
    }
    if kind == "template.create" {
        if let Some(remote) = remote_template.as_ref() {
            let remote_id = string_param(remote, "id")?;
            let remote_exists: bool = database
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM memo_templates WHERE id = ?1)",
                    [&remote_id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            if remote_exists {
                database
                    .execute("DELETE FROM memo_templates WHERE id = ?1", [&entity_id])
                    .map_err(|e| e.to_string())?;
            } else {
                database
                    .execute(
                        "UPDATE memo_templates SET id = ?1 WHERE id = ?2",
                        rusqlite::params![remote_id, entity_id],
                    )
                    .map_err(|e| e.to_string())?;
            }
            let mut pending = database.prepare("SELECT id, entity_id, payload_json FROM _edgeever_sidecar_outbox WHERE id <> ?1").map_err(|e| e.to_string())?;
            let rows: Vec<(i64, String, String)> = pending
                .query_map([id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .map_err(|e| e.to_string())?
                .collect::<Result<_, _>>()
                .map_err(|e| e.to_string())?;
            for (outbox_id, outbox_entity, payload_text) in rows {
                if outbox_entity != entity_id && !payload_text.contains(&entity_id) {
                    continue;
                }
                let mut payload: Value =
                    serde_json::from_str(&payload_text).unwrap_or_else(|_| json!({}));
                if payload.get("templateId").and_then(Value::as_str) == Some(entity_id.as_str()) {
                    payload["templateId"] = json!(remote_id);
                }
                if payload.get("temporaryId").and_then(Value::as_str) == Some(entity_id.as_str()) {
                    payload["temporaryId"] = json!(remote_id);
                }
                let next_entity = if outbox_entity == entity_id {
                    remote_id.clone()
                } else {
                    outbox_entity
                };
                database.execute("UPDATE _edgeever_sidecar_outbox SET entity_id = ?1, payload_json = ?2, version = version + 1 WHERE id = ?3", rusqlite::params![next_entity, payload.to_string(), outbox_id]).map_err(|e| e.to_string())?;
            }
        }
    }
    let deleted = if let Some(version) = requested_version {
        database
            .execute(
                "DELETE FROM _edgeever_sidecar_outbox WHERE id = ?1 AND version = ?2",
                rusqlite::params![id, version],
            )
            .map_err(|e| e.to_string())?
    } else {
        database
            .execute("DELETE FROM _edgeever_sidecar_outbox WHERE id = ?1", [id])
            .map_err(|e| e.to_string())?
    };
    Ok(
        json!({ "ok": true, "superseded": deleted == 0, "memo": remote_memo, "notebook": remote_notebook, "template": remote_template }),
    )
}

fn sync_outbox_fail(database: &Connection, params: &Value) -> Result<Value, String> {
    let id = params
        .get("id")
        .and_then(Value::as_i64)
        .ok_or_else(|| "Missing outbox id".to_owned())?;
    let error = params
        .get("error")
        .and_then(Value::as_str)
        .unwrap_or("sync failed");
    let status = if bool_param(params, "conflict", false) {
        "conflict"
    } else {
        "error"
    };
    let error_code = params.get("errorCode").and_then(Value::as_str);
    let retryable = params
        .get("retryable")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let next_attempt_at = params.get("nextAttemptAt").and_then(Value::as_str);
    let updated = if let Some(version) = params.get("version").and_then(Value::as_i64) {
        database.execute("UPDATE _edgeever_sidecar_outbox SET status = ?1, attempt_count = attempt_count + 1, last_error = ?2, last_error_code = ?3, retryable = ?4, next_attempt_at = ?5, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?6 AND version = ?7", rusqlite::params![status, error, error_code, retryable, next_attempt_at, id, version]).map_err(|e| e.to_string())?
    } else {
        database.execute("UPDATE _edgeever_sidecar_outbox SET status = ?1, attempt_count = attempt_count + 1, last_error = ?2, last_error_code = ?3, retryable = ?4, next_attempt_at = ?5, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?6", rusqlite::params![status, error, error_code, retryable, next_attempt_at, id]).map_err(|e| e.to_string())?
    };
    Ok(json!({ "ok": true, "superseded": updated == 0 }))
}

fn sync_outbox_retry(database: &Connection, params: &Value) -> Result<Value, String> {
    let id = params
        .get("id")
        .and_then(Value::as_i64)
        .ok_or_else(|| "Missing outbox id".to_owned())?;
    let version = params.get("version").and_then(Value::as_i64);
    let updated = if let Some(version) = version {
        database.execute(
            "UPDATE _edgeever_sidecar_outbox SET status = 'pending', retryable = 1, next_attempt_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1 AND version = ?2 AND status = 'error'",
            rusqlite::params![id, version],
        )
    } else {
        database.execute(
            "UPDATE _edgeever_sidecar_outbox SET status = 'pending', retryable = 1, next_attempt_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1 AND status = 'error'",
            [id],
        )
    }
    .map_err(|e| e.to_string())?;
    if updated == 0 {
        return Err("The failed sync item changed before retry".to_owned());
    }
    Ok(json!({ "ok": true }))
}

fn sync_outbox_recover_memo_update(database: &Connection, params: &Value) -> Result<Value, String> {
    let id = params
        .get("id")
        .and_then(Value::as_i64)
        .ok_or_else(|| "Missing outbox id".to_owned())?;
    let notebook_id = string_param(params, "notebookId")?;
    let requested_version = params.get("version").and_then(Value::as_i64);
    let (kind, payload_text, version, status): (String, String, i64, String) = database
        .query_row(
            "SELECT kind, payload_json, version, status FROM _edgeever_sidecar_outbox WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|e| e.to_string())?;
    if kind != "memo.update" || status != "error" {
        return Err("Only failed memo updates can be recovered".to_owned());
    }
    if requested_version.is_some_and(|value| value != version) {
        return Err("The failed update changed before recovery".to_owned());
    }
    let notebook_exists: bool = database
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM notebooks WHERE id = ?1 AND is_deleted = 0)",
            [&notebook_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !notebook_exists {
        return Err("Recovery notebook not found".to_owned());
    }
    let mut payload: Value = serde_json::from_str(&payload_text).map_err(|e| e.to_string())?;
    let object = payload
        .as_object_mut()
        .ok_or_else(|| "Invalid failed memo payload".to_owned())?;
    object.insert("notebookId".to_owned(), json!(notebook_id));
    let memo = create_memo(database, &payload)?;
    let recovered_id = string_param(&memo, "id")?;
    payload["memoId"] = json!(recovered_id);
    payload["expectedRevision"] = json!(0);
    payload["expectedContentHash"] = memo
        .get("contentHash")
        .cloned()
        .unwrap_or_else(|| json!(""));
    enqueue_change(database, "memo.update", &recovered_id, &payload)?;
    let removed = database
        .execute(
            "DELETE FROM _edgeever_sidecar_outbox WHERE id = ?1 AND version = ?2 AND status = 'error'",
            rusqlite::params![id, version],
        )
        .map_err(|e| e.to_string())?;
    if removed == 0 {
        database
            .execute(
                "DELETE FROM _edgeever_sidecar_outbox WHERE entity_id = ?1",
                [&recovered_id],
            )
            .ok();
        database
            .execute("DELETE FROM memos WHERE id = ?1", [&recovered_id])
            .ok();
        return Err("The failed update changed before recovery".to_owned());
    }
    Ok(json!({ "ok": true, "memo": memo }))
}

fn sync_outbox_discard(database: &Connection, params: &Value) -> Result<Value, String> {
    let id = params
        .get("id")
        .and_then(Value::as_i64)
        .ok_or_else(|| "Missing outbox id".to_owned())?;
    let removed = if let Some(version) = params.get("version").and_then(Value::as_i64) {
        database.execute(
            "DELETE FROM _edgeever_sidecar_outbox WHERE id = ?1 AND version = ?2",
            rusqlite::params![id, version],
        )
    } else {
        database.execute("DELETE FROM _edgeever_sidecar_outbox WHERE id = ?1", [id])
    }
    .map_err(|e| e.to_string())?;
    if removed == 0 {
        return Err("The sync item changed before it was discarded".to_owned());
    }
    Ok(json!({ "ok": true }))
}

fn apply_sync_changes(database: &Connection, params: &Value) -> Result<Value, String> {
    let changes = params
        .get("changes")
        .and_then(Value::as_array)
        .ok_or_else(|| "Missing changes array".to_owned())?;
    let rebuilding = meta_value(database, SYNC_BOOTSTRAP_RESET_KEY).as_deref() == Some("1");
    let tx = database
        .unchecked_transaction()
        .map_err(|e| e.to_string())?;
    for change in changes {
        let entity_type = string_param(change, "entityType")?;
        let operation = string_param(change, "operation")?;
        let entity_id = string_param(change, "entityId")?;
        if rebuilding {
            let preserved_table = if entity_type == "notebook" {
                "_edgeever_bootstrap_preserved_notebooks"
            } else {
                "_edgeever_bootstrap_preserved_memos"
            };
            let preserved = tx
                .query_row(
                    &format!("SELECT EXISTS(SELECT 1 FROM {preserved_table} WHERE id = ?1)"),
                    [&entity_id],
                    |row| row.get::<_, bool>(0),
                )
                .unwrap_or(false);
            if preserved {
                continue;
            }
        }
        if entity_type == "notebook" {
            if operation == "delete" {
                tx.execute("UPDATE notebooks SET is_deleted = 1, deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1", [&entity_id]).map_err(|e| e.to_string())?;
                continue;
            }
            let notebook = change
                .get("notebook")
                .ok_or_else(|| "Missing notebook change payload".to_owned())?;
            tx.execute("INSERT INTO notebooks (id, parent_id, name, slug, icon, color, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id, name=excluded.name, slug=excluded.slug, icon=excluded.icon, color=excluded.color, sort_order=excluded.sort_order, updated_at=excluded.updated_at, is_deleted=0", rusqlite::params![entity_id, notebook.get("parentId").and_then(Value::as_str), string_param(notebook, "name")?, notebook.get("slug").and_then(Value::as_str), notebook.get("icon").and_then(Value::as_str), notebook.get("color").and_then(Value::as_str), notebook.get("sortOrder").and_then(Value::as_i64).unwrap_or(0), string_param(notebook, "createdAt")?, string_param(notebook, "updatedAt")?]).map_err(|e| e.to_string())?;
            continue;
        }
        if operation == "delete" {
            tx.execute("UPDATE memos SET is_deleted = 1, deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1", [&entity_id]).map_err(|e| e.to_string())?;
            continue;
        }
        let memo = change
            .get("memo")
            .ok_or_else(|| "Missing memo change payload".to_owned())?;
        let tags = memo
            .get("tags")
            .cloned()
            .unwrap_or_else(|| json!([]))
            .to_string();
        let source_ids = memo
            .get("sourceMemoIds")
            .cloned()
            .unwrap_or_else(|| json!([]))
            .to_string();
        let content_json = memo
            .get("contentJson")
            .cloned()
            .unwrap_or_else(|| json!({"type":"doc","content":[]}));
        tx.execute("INSERT INTO memos (id, notebook_id, title, excerpt, tags_json, is_pinned, is_archived, is_deleted, source_memo_ids, merge_source_count, merged_into_memo_id, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14) ON CONFLICT(id) DO UPDATE SET notebook_id=excluded.notebook_id, title=excluded.title, excerpt=excluded.excerpt, tags_json=excluded.tags_json, is_pinned=excluded.is_pinned, is_archived=excluded.is_archived, is_deleted=excluded.is_deleted, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at", rusqlite::params![entity_id, string_param(memo, "notebookId")?, memo.get("title").and_then(Value::as_str), string_param(memo, "excerpt")?, tags, memo.get("isPinned").and_then(Value::as_bool).unwrap_or(false) as i64, memo.get("isArchived").and_then(Value::as_bool).unwrap_or(false) as i64, memo.get("isDeleted").and_then(Value::as_bool).unwrap_or(false) as i64, source_ids, memo.get("mergeSourceCount").and_then(Value::as_i64).unwrap_or(0), memo.get("mergedIntoMemoId").and_then(Value::as_str), string_param(memo, "createdAt")?, string_param(memo, "updatedAt")?, memo.get("deletedAt").and_then(Value::as_str)]).map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO memo_contents (memo_id, content_json, content_markdown, content_text, content_hash, revision) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(memo_id) DO UPDATE SET content_json=excluded.content_json, content_markdown=excluded.content_markdown, content_text=excluded.content_text, content_hash=excluded.content_hash, revision=excluded.revision, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')", rusqlite::params![entity_id, content_json.to_string(), string_param(memo, "contentMarkdown")?, string_param(memo, "contentText")?, string_param(memo, "contentHash")?, memo.get("revision").and_then(Value::as_i64).unwrap_or(0)]).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(json!({ "applied": changes.len() }))
}

fn handle(
    request: RpcRequest,
    database: &mut Connection,
    root: &Path,
    migrations: &Path,
) -> Result<Value, String> {
    match request.method.as_str() {
        "system.info" => Ok(json!({
            "platform": env::consts::OS,
            "architecture": env::consts::ARCH,
            "dataDir": root,
            "protocolVersion": PROTOCOL_VERSION,
        })),
        "storage.health" => database
            .query_row("SELECT 1", [], |row| row.get::<_, i64>(0))
            .map(|_| json!({ "ok": true }))
            .map_err(|error| error.to_string()),
        "storage.backup" => backup_database(database, root)
            .map(|path| json!({ "ok": true, "path": path }))
            .map_err(|error| error.to_string()),
        "storage.backups" => list_backups(root).map_err(|error| error.to_string()),
        "storage.restore" => restore_database(database, root, migrations, &request.params),
        "sync.status" => sync_status(database),
        "sync.bootstrap.prepare" => prepare_sync_bootstrap(database, &request.params),
        "sync.outbox.list" => sync_outbox_list(database, &request.params),
        "sync.outbox.ack" => sync_outbox_ack(database, &request.params),
        "sync.outbox.fail" => sync_outbox_fail(database, &request.params),
        "sync.outbox.retry" => sync_outbox_retry(database, &request.params),
        "sync.outbox.recoverMemoUpdate" => {
            sync_outbox_recover_memo_update(database, &request.params)
        }
        "sync.outbox.discard" => sync_outbox_discard(database, &request.params),
        "sync.apply" => apply_sync_changes(database, &request.params),
        "sync.cursor.set" => {
            set_meta(
                database,
                "sync.cursor",
                &request
                    .params
                    .get("cursor")
                    .and_then(Value::as_i64)
                    .unwrap_or(0)
                    .to_string(),
            )?;
            set_meta(
                database,
                "sync.identity",
                request
                    .params
                    .get("syncIdentity")
                    .and_then(Value::as_str)
                    .unwrap_or(""),
            )?;
            set_meta(database, "sync.last_synced_at", &chrono_like_now())?;
            database
                .execute(
                    "DELETE FROM _edgeever_sidecar_meta WHERE key = ?1",
                    [SYNC_BOOTSTRAP_RESET_KEY],
                )
                .map_err(|e| e.to_string())?;
            database
                .execute_batch(
                    "DROP TABLE IF EXISTS temp._edgeever_bootstrap_preserved_memos;
                     DROP TABLE IF EXISTS temp._edgeever_bootstrap_preserved_notebooks;",
                )
                .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true }))
        }
        "notebook.list" => list_notebooks(database),
        "notebook.create" => create_notebook(database, &request.params)
            .map(|notebook| json!({ "notebook": notebook })),
        "notebook.update" => update_notebook(database, &request.params)
            .map(|notebook| json!({ "notebook": notebook })),
        "notebook.delete" => delete_notebook(database, &request.params),
        "notebook.restore" => restore_notebook(database, &request.params)
            .map(|notebook| json!({ "notebook": notebook })),
        "template.list" => list_templates(database),
        "template.cache" => cache_template(database, &request.params),
        "template.create" => create_template(database, &request.params)
            .map(|template| json!({ "template": template })),
        "template.update" => update_template(database, &request.params)
            .map(|template| json!({ "template": template })),
        "template.delete" => delete_template(database, &request.params),
        "resource.list" => list_resources(database, &request.params),
        "resource.cache" => cache_resource(database, &request.params),
        "resource.delete" => delete_cached_resource(database, &request.params),
        "tag.list" => list_tags(database),
        "tag.rename" => rewrite_tag(database, &request.params, false),
        "tag.delete" => rewrite_tag(database, &request.params, true),
        "memo.moveBatch" => move_memos(database, &request.params),
        "memo.deleteBatch" => delete_memos(database, &request.params),
        "memo.emptyTrash" => empty_trash(database),
        "memo.pinBatch" => pin_memos(database, &request.params),
        "memo.merge" => merge_memos(database, &request.params),
        "memo.list" => list_memos(database, &request.params),
        "memo.get" => {
            let memo_id = string_param(&request.params, "memoId")?;
            memo_value(
                database,
                &memo_id,
                bool_param(&request.params, "includeDeleted", false),
            )
            .map(|memo| json!({ "memo": memo }))
        }
        "memo.create" => create_memo(database, &request.params).map(|memo| json!({ "memo": memo })),
        "memo.update" => update_memo(database, &request.params).map(|memo| json!({ "memo": memo })),
        "memo.delete" => delete_memo(database, &request.params),
        "memo.restore" => {
            restore_memo(database, &request.params).map(|memo| json!({ "memo": memo }))
        }
        "memo.revisions" => list_memo_revisions(database, &request.params),
        "memo.restoreRevision" => restore_memo_revision(database, &request.params),
        "memo.revision.cache" => cache_memo_revision(database, &request.params),
        "app.shutdown" => Ok(json!({ "ok": true })),
        _ => Err(format!("Unknown sidecar method: {}", request.method)),
    }
}

fn chrono_like_now() -> String {
    // SQLite owns persisted timestamps; this value is only a human-readable sync marker.
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
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
