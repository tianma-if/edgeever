use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::memo::memo_value;
use crate::{enqueue_change, markdown_doc, now_id, string_param, tags_from_json};

pub(crate) fn is_inbox_notebook(id: &str, slug: Option<&str>) -> bool {
    slug == Some("inbox") || id == "nb_inbox" || id.ends_with("_inbox")
}

pub(crate) fn list_notebooks(database: &Connection) -> Result<Value, String> {
    let mut statement = database.prepare(
        "SELECT n.id, n.parent_id, n.name, n.slug, n.icon, n.color, n.color_target, n.is_bold, n.icon_inverted, n.row_inverted, n.text_color, n.sort_order, n.created_at, n.updated_at,
                COUNT(CASE WHEN m.is_deleted = 0 THEN 1 END) AS memo_count,
                MAX(CASE WHEN m.is_deleted = 0 THEN m.updated_at END) AS last_memo_updated_at
           FROM notebooks n LEFT JOIN memos m ON m.notebook_id = n.id
          WHERE n.is_deleted = 0 GROUP BY n.id ORDER BY n.sort_order, n.name",
    ).map_err(|e| e.to_string())?;
    let rows = statement.query_map([], |row| Ok(json!({
        "id": row.get::<_, String>("id")?, "parentId": row.get::<_, Option<String>>("parent_id")?,
        "name": row.get::<_, String>("name")?, "slug": row.get::<_, Option<String>>("slug")?,
        "icon": row.get::<_, Option<String>>("icon")?, "color": row.get::<_, Option<String>>("color")?,
        "colorTarget": row.get::<_, String>("color_target")?,
        "isBold": row.get::<_, i64>("is_bold")? != 0,
        "iconInverted": row.get::<_, i64>("icon_inverted")? != 0,
        "rowInverted": row.get::<_, i64>("row_inverted")? != 0,
        "textColor": row.get::<_, Option<String>>("text_color")?,
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
        "SELECT n.id, n.parent_id, n.name, n.slug, n.icon, n.color, n.color_target, n.is_bold, n.icon_inverted, n.row_inverted, n.text_color, n.sort_order, n.created_at, n.updated_at,
                COUNT(CASE WHEN m.is_deleted = 0 THEN 1 END) AS memo_count,
                MAX(CASE WHEN m.is_deleted = 0 THEN m.updated_at END) AS last_memo_updated_at
           FROM notebooks n LEFT JOIN memos m ON m.notebook_id = n.id
          WHERE n.id = ?1 AND (?2 OR n.is_deleted = 0) GROUP BY n.id",
    ).map_err(|e| e.to_string())?;
    statement.query_row(rusqlite::params![notebook_id, include_deleted as i64], |row| Ok(json!({
        "id": row.get::<_, String>("id")?, "parentId": row.get::<_, Option<String>>("parent_id")?,
        "name": row.get::<_, String>("name")?, "slug": row.get::<_, Option<String>>("slug")?,
        "icon": row.get::<_, Option<String>>("icon")?, "color": row.get::<_, Option<String>>("color")?,
        "colorTarget": row.get::<_, String>("color_target")?,
        "isBold": row.get::<_, i64>("is_bold")? != 0,
        "iconInverted": row.get::<_, i64>("icon_inverted")? != 0,
        "rowInverted": row.get::<_, i64>("row_inverted")? != 0,
        "textColor": row.get::<_, Option<String>>("text_color")?,
        "sortOrder": row.get::<_, i64>("sort_order")?, "memoCount": row.get::<_, i64>("memo_count")?,
        "lastMemoUpdatedAt": row.get::<_, Option<String>>("last_memo_updated_at")?,
        "createdAt": row.get::<_, String>("created_at")?, "updatedAt": row.get::<_, String>("updated_at")?,
    }))).map_err(|e| e.to_string())
}

pub(crate) fn create_notebook(database: &Connection, params: &Value) -> Result<Value, String> {
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

pub(crate) fn update_notebook(database: &Connection, params: &Value) -> Result<Value, String> {
    let notebook_id = string_param(params, "notebookId")?;
    // Keep the notebook and its queued sync operation atomic, including rejected payloads.
    let transaction = database
        .unchecked_transaction()
        .map_err(|e| e.to_string())?;
    let database = &transaction;

    if let Some(name) = params.get("name").and_then(Value::as_str) {
        let current_slug: Option<String> = database
            .query_row(
                "SELECT slug FROM notebooks WHERE id = ?1",
                [&notebook_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        let slug = if is_inbox_notebook(&notebook_id, current_slug.as_deref()) {
            "inbox".to_owned()
        } else {
            name.to_lowercase().replace(' ', "-")
        };
        database.execute("UPDATE notebooks SET name = ?1, slug = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?3 AND is_deleted = 0", rusqlite::params![name, slug, notebook_id]).map_err(|e| e.to_string())?;
    }
    if params.get("parentId").is_some() {
        database.execute("UPDATE notebooks SET parent_id = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?2 AND is_deleted = 0", rusqlite::params![params.get("parentId").and_then(Value::as_str), notebook_id]).map_err(|e| e.to_string())?;
    }
    if let Some(sort_order) = params.get("sortOrder").and_then(Value::as_i64) {
        database.execute("UPDATE notebooks SET sort_order = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?2 AND is_deleted = 0", rusqlite::params![sort_order, notebook_id]).map_err(|e| e.to_string())?;
    }
    for (key, column) in [
        ("icon", "icon"),
        ("color", "color"),
        ("textColor", "text_color"),
        ("colorTarget", "color_target"),
    ] {
        if let Some(value) = params.get(key) {
            let text = value.as_str();
            if !value.is_null() && text.is_none() {
                return Err(format!("Invalid notebook {key}"));
            }
            if matches!(key, "color" | "textColor")
                && text.is_some_and(|color| {
                    color.len() != 7
                        || !color.starts_with('#')
                        || !color[1..].bytes().all(|c| c.is_ascii_hexdigit())
                })
            {
                return Err(format!("Invalid notebook {key}"));
            }
            if key == "icon"
                && text.is_some_and(|icon| {
                    icon.is_empty()
                        || icon.len() > 80
                        || !icon.as_bytes()[0].is_ascii_lowercase()
                        || !icon
                            .bytes()
                            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
                })
            {
                return Err("Invalid notebook icon".to_owned());
            }
            if key == "colorTarget" && !matches!(text, Some("icon" | "name" | "both")) {
                return Err("Invalid notebook color target".to_owned());
            }
            database.execute(
                &format!("UPDATE notebooks SET {column} = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?2 AND is_deleted = 0"),
                rusqlite::params![text, notebook_id],
            ).map_err(|e| e.to_string())?;
        }
    }
    if let Some(value) = params.get("isBold") {
        let bold = value
            .as_bool()
            .ok_or_else(|| "Invalid notebook bold value".to_owned())?;
        database.execute("UPDATE notebooks SET is_bold = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?2 AND is_deleted = 0", rusqlite::params![i64::from(bold), notebook_id]).map_err(|e| e.to_string())?;
    }
    if let Some(value) = params.get("iconInverted") {
        let inverted = value
            .as_bool()
            .ok_or_else(|| "Invalid notebook inverted icon value".to_owned())?;
        database.execute("UPDATE notebooks SET icon_inverted = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?2 AND is_deleted = 0", rusqlite::params![i64::from(inverted), notebook_id]).map_err(|e| e.to_string())?;
    }
    if let Some(value) = params.get("rowInverted") {
        let inverted = value
            .as_bool()
            .ok_or_else(|| "Invalid notebook inverted icon value".to_owned())?;
        database.execute("UPDATE notebooks SET row_inverted = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?2 AND is_deleted = 0", rusqlite::params![i64::from(inverted), notebook_id]).map_err(|e| e.to_string())?;
    }
    let notebook = notebook_value(database, &notebook_id, true)?;
    enqueue_change(database, "notebook.update", &notebook_id, params)?;
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(notebook)
}

struct ActiveNotebook {
    id: String,
    slug: Option<String>,
}

fn active_notebook_tree(
    database: &Connection,
    notebook_id: &str,
) -> Result<Vec<ActiveNotebook>, String> {
    let mut statement = database
        .prepare(
            "WITH RECURSIVE tree(id, depth) AS (
               SELECT id, 0 FROM notebooks WHERE id = ?1
               UNION ALL
               SELECT n.id, tree.depth + 1
               FROM notebooks n
               INNER JOIN tree ON n.parent_id = tree.id
               WHERE n.is_deleted = 0
             )
             SELECT n.id, n.slug
             FROM tree
             INNER JOIN notebooks n ON n.id = tree.id
             WHERE n.is_deleted = 0
             ORDER BY tree.depth DESC, n.id",
        )
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([notebook_id], |row| {
            Ok(ActiveNotebook {
                id: row.get(0)?,
                slug: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub(crate) fn delete_notebook(
    database: &Connection,
    params: &Value,
    include_notes: bool,
) -> Result<Value, String> {
    let notebook_id = string_param(params, "notebookId")?;
    let tx = database
        .unchecked_transaction()
        .map_err(|e| e.to_string())?;
    let current_slug: Option<Option<String>> = tx
        .query_row(
            "SELECT slug FROM notebooks WHERE id = ?1",
            [&notebook_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(current_slug) = current_slug else {
        return Err(format!("Notebook not found: {notebook_id}"));
    };
    if is_inbox_notebook(&notebook_id, current_slug.as_deref()) {
        return Err("inbox_not_deletable".to_owned());
    }

    let tree = active_notebook_tree(&tx, &notebook_id)?;
    if tree.is_empty() {
        return Ok(json!({ "ok": true }));
    }
    if tree
        .iter()
        .any(|notebook| is_inbox_notebook(&notebook.id, notebook.slug.as_deref()))
    {
        return Err("inbox_not_deletable".to_owned());
    }

    let ids: Vec<String> = tree.iter().map(|notebook| notebook.id.clone()).collect();
    let ids_json = json!(ids).to_string();
    if include_notes {
        tx.execute(
            "UPDATE memos
             SET is_deleted = 1, deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE notebook_id IN (SELECT value FROM json_each(?1)) AND is_deleted = 0",
            [&ids_json],
        )
        .map_err(|e| e.to_string())?;
    } else {
        let has_memos: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM memos
             WHERE notebook_id IN (SELECT value FROM json_each(?1)) AND is_deleted = 0)",
            [&ids_json],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        if has_memos {
            return Err("notebook_not_empty".to_owned());
        }
    }
    tx.execute(
        "UPDATE notebooks
         SET is_deleted = 1, deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id IN (SELECT value FROM json_each(?1)) AND is_deleted = 0",
        [&ids_json],
    )
    .map_err(|e| e.to_string())?;
    enqueue_change(
        &tx,
        if include_notes { "notebook.trash" } else { "notebook.delete" },
        &notebook_id,
        &json!({ "notebookId": notebook_id, "notebookIds": ids }),
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

pub(crate) fn restore_notebook(database: &Connection, params: &Value) -> Result<Value, String> {
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

pub(crate) fn list_templates(database: &Connection) -> Result<Value, String> {
    let mut statement = database.prepare("SELECT id, name, description, title, content_json, content_markdown, tags_json, created_at, updated_at FROM memo_templates ORDER BY updated_at DESC, name").map_err(|e| e.to_string())?;
    let rows = statement.query_map([], |row| {
        let content_json: String = row.get("content_json")?;
        let tags: String = row.get("tags_json")?;
        Ok(json!({ "id": row.get::<_, String>("id")?, "name": row.get::<_, String>("name")?, "description": row.get::<_, Option<String>>("description")?, "title": row.get::<_, Option<String>>("title")?, "contentJson": serde_json::from_str::<Value>(&content_json).unwrap_or_else(|_| json!({"type":"doc","content":[]})), "contentMarkdown": row.get::<_, String>("content_markdown")?, "tags": tags_from_json(&tags), "createdAt": row.get::<_, String>("created_at")?, "updatedAt": row.get::<_, String>("updated_at")? }))
    }).map_err(|e| e.to_string())?;
    let templates: Result<Vec<_>, _> = rows.collect();
    Ok(json!({ "templates": templates.map_err(|e| e.to_string())? }))
}

pub(crate) fn cache_template(database: &Connection, params: &Value) -> Result<Value, String> {
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

pub(crate) fn create_template(database: &Connection, params: &Value) -> Result<Value, String> {
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

pub(crate) fn update_template(database: &Connection, params: &Value) -> Result<Value, String> {
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

pub(crate) fn delete_template(database: &Connection, params: &Value) -> Result<Value, String> {
    let template_id = string_param(params, "templateId")?;
    database
        .execute("DELETE FROM memo_templates WHERE id = ?1", [&template_id])
        .map_err(|e| e.to_string())?;
    enqueue_change(database, "template.delete", &template_id, params)?;
    Ok(json!({ "ok": true }))
}

pub(crate) fn list_resources(database: &Connection, params: &Value) -> Result<Value, String> {
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

// Point lookup for cache validation; never scan the attachment catalog per opening.
pub(crate) fn resource_integrity(database: &Connection, params: &Value) -> Result<Value, String> {
    let id = string_param(params, "resourceId")?;
    database.query_row(
        "SELECT byte_size, sha256 FROM resources WHERE id = ?1 AND is_deleted = 0",
        [&id],
        |row| Ok(json!({ "byteSize": row.get::<_, i64>(0)?, "sha256": row.get::<_, Option<String>>(1)? })),
    ).optional().map(|value| value.unwrap_or(Value::Null)).map_err(|e| e.to_string())
}

pub(crate) fn cache_resource(database: &Connection, params: &Value) -> Result<Value, String> {
    let resource = params
        .get("resource")
        .ok_or_else(|| "Missing resource payload".to_owned())?;
    let id = string_param(resource, "id")?;
    let memo_id = string_param(resource, "memoId")?;
    database.execute("INSERT INTO resources (id, memo_id, original_memo_id, bucket_name, object_key, kind, mime_type, filename, byte_size, sha256, width, height, metadata_json) VALUES (?1, ?2, ?3, 'edgeever-resources', ?1, ?4, ?5, ?6, ?7, ?8, ?9, ?10, '{}') ON CONFLICT(id) DO UPDATE SET memo_id=excluded.memo_id, kind=excluded.kind, mime_type=excluded.mime_type, filename=excluded.filename, byte_size=excluded.byte_size, sha256=excluded.sha256, width=excluded.width, height=excluded.height, is_deleted=0, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')", rusqlite::params![id, memo_id, resource.get("originalMemoId").and_then(Value::as_str), string_param(resource, "kind")?, resource.get("mimeType").and_then(Value::as_str), resource.get("filename").and_then(Value::as_str), resource.get("byteSize").and_then(Value::as_i64).unwrap_or(0), resource.get("sha256").and_then(Value::as_str), resource.get("width").and_then(Value::as_i64), resource.get("height").and_then(Value::as_i64)]).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

pub(crate) fn delete_cached_resource(
    database: &Connection,
    params: &Value,
) -> Result<Value, String> {
    let resource_id = string_param(params, "resourceId")?;
    database
        .execute("DELETE FROM resources WHERE id = ?1", [&resource_id])
        .map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

pub(crate) fn list_tags(database: &Connection) -> Result<Value, String> {
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

pub(crate) fn rewrite_tag(
    database: &Connection,
    params: &Value,
    delete: bool,
) -> Result<Value, String> {
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

#[cfg(test)]
mod appearance_tests {
    use super::*;

    #[test]
    fn appearance_survives_local_edits_and_sync_and_can_be_disabled() {
        let root = std::env::temp_dir().join(now_id("edgeever-bold-test"));
        let migrations = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../migrations");
        let database = crate::database::open_database(&root, &migrations).unwrap();
        let created = create_notebook(&database, &json!({"name": "Heimnetz"})).unwrap();
        let id = created["id"].as_str().unwrap();
        let bold = update_notebook(&database, &json!({"notebookId": id, "isBold": true, "iconInverted": true, "rowInverted": true, "icon": "house", "color": "#2563eb", "textColor": "#dc2626"})).unwrap();
        assert_eq!(bold["isBold"], true);
        let renamed =
            update_notebook(&database, &json!({"notebookId": id, "name": "Network"})).unwrap();
        assert_eq!(renamed["isBold"], true);
        assert_eq!(renamed["iconInverted"], true);
        assert_eq!(renamed["rowInverted"], true);
        assert_eq!(renamed["icon"], "house");
        assert_eq!(renamed["color"], "#2563eb");
        assert_eq!(renamed["textColor"], "#dc2626");
        let before = notebook_value(&database, id, false).unwrap();
        let queued: i64 = database
            .query_row("SELECT COUNT(*) FROM _edgeever_sidecar_outbox", [], |row| {
                row.get(0)
            })
            .unwrap();
        for invalid in [
            json!({"rowInverted": "yes"}),
            json!({"color": "red"}),
            json!({"textColor": 5}),
            json!({"icon": "../house"}),
        ] {
            let mut params = invalid;
            params["notebookId"] = json!(id);
            params["name"] = json!("Must roll back");
            assert!(update_notebook(&database, &params).is_err());
            assert_eq!(notebook_value(&database, id, false).unwrap(), before);
            assert_eq!(
                database
                    .query_row("SELECT COUNT(*) FROM _edgeever_sidecar_outbox", [], |row| {
                        row.get::<_, i64>(0)
                    })
                    .unwrap(),
                queued
            );
        }

        let payload: String = database.query_row(
            "SELECT payload_json FROM _edgeever_sidecar_outbox WHERE kind = 'notebook.update' ORDER BY id LIMIT 1",
            [], |row| row.get(0),
        ).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&payload).unwrap()["isBold"],
            true
        );
        let plain =
            update_notebook(&database, &json!({"notebookId": id, "isBold": false})).unwrap();
        assert_eq!(plain["isBold"], false);
        let mut remote = plain.clone();
        remote["isBold"] = json!(true);
        remote["textColor"] = json!("#16a34a");
        remote["iconInverted"] = json!(false);
        remote["rowInverted"] = json!(false);
        crate::sync::apply_sync_changes(
            &database,
            &json!({"changes": [{
                "entityType": "notebook", "entityId": id, "operation": "upsert", "notebook": remote,
            }]}),
        )
        .unwrap();
        assert_eq!(
            notebook_value(&database, id, false).unwrap()["isBold"],
            true
        );
        assert_eq!(
            notebook_value(&database, id, false).unwrap()["iconInverted"],
            false
        );
        assert_eq!(
            notebook_value(&database, id, false).unwrap()["rowInverted"],
            false
        );
        assert_eq!(
            notebook_value(&database, id, false).unwrap()["textColor"],
            "#16a34a"
        );
        remote.as_object_mut().unwrap().remove("isBold");
        crate::sync::apply_sync_changes(
            &database,
            &json!({"changes": [{
                "entityType": "notebook", "entityId": id, "operation": "upsert", "notebook": remote,
            }]}),
        )
        .unwrap();
        assert_eq!(
            notebook_value(&database, id, false).unwrap()["isBold"],
            false
        );
        drop(database);
        std::fs::remove_dir_all(root).unwrap();
    }
}
