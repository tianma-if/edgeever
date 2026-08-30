use rusqlite::Connection;
use serde_json::{json, Value};

use crate::{
    bool_param, content_hash, enqueue_change, markdown_doc, memo_remap_base_key, now_id,
    resolve_remapped_memo_base, string_param, tags_from_json,
};

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

pub(crate) fn memo_value(
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

pub(crate) fn list_memo_revisions(database: &Connection, params: &Value) -> Result<Value, String> {
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

pub(crate) fn cache_memo_revision(database: &Connection, params: &Value) -> Result<Value, String> {
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

pub(crate) fn move_memos(database: &Connection, params: &Value) -> Result<Value, String> {
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

pub(crate) fn delete_memos(database: &Connection, params: &Value) -> Result<Value, String> {
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

pub(crate) fn empty_trash(database: &Connection) -> Result<Value, String> {
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

pub(crate) fn pin_memos(database: &Connection, params: &Value) -> Result<Value, String> {
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

pub(crate) fn merge_memos(database: &Connection, params: &Value) -> Result<Value, String> {
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

pub(crate) fn resolve_custom_merge_title<'a>(
    titles: impl IntoIterator<Item = &'a str>,
) -> Option<String> {
    titles
        .into_iter()
        .map(str::trim)
        .find(|title| !title.is_empty() && *title != "无标题笔记")
        .map(str::to_owned)
}

pub(crate) fn resolve_sidecar_merge_markdown(
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

pub(crate) fn list_memos(database: &Connection, params: &Value) -> Result<Value, String> {
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

pub(crate) fn create_memo(database: &Connection, params: &Value) -> Result<Value, String> {
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

pub(crate) fn update_memo(database: &Connection, params: &Value) -> Result<Value, String> {
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

pub(crate) fn delete_memo(database: &Connection, params: &Value) -> Result<Value, String> {
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

pub(crate) fn restore_memo(database: &Connection, params: &Value) -> Result<Value, String> {
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

pub(crate) fn restore_memo_revision(
    database: &Connection,
    params: &Value,
) -> Result<Value, String> {
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
