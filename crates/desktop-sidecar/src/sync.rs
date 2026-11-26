use rusqlite::{Connection, OptionalExtension, Transaction};
use serde_json::{json, Value};

use crate::catalog::is_inbox_notebook;
use crate::memo::{create_memo, memo_value};
use crate::{bool_param, enqueue_change, memo_remap_base_key, meta_value, set_meta, string_param};

pub(crate) fn sync_status(database: &Connection) -> Result<Value, String> {
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

pub(crate) const SYNC_BOOTSTRAP_RESET_KEY: &str = "sync.bootstrap.reset_pending";

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

pub(crate) fn prepare_sync_bootstrap(
    database: &Connection,
    params: &Value,
) -> Result<Value, String> {
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

pub(crate) fn sync_outbox_list(database: &Connection, params: &Value) -> Result<Value, String> {
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

pub(crate) fn sync_outbox_ack(database: &Connection, params: &Value) -> Result<Value, String> {
    let id = params
        .get("id")
        .and_then(Value::as_i64)
        .ok_or_else(|| "Missing outbox id".to_owned())?;
    let (kind, entity_id, payload_json, current_version): (String, String, String, i64) = database
        .query_row(
            "SELECT kind, entity_id, payload_json, version FROM _edgeever_sidecar_outbox WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|e| e.to_string())?;
    let requested_version = params.get("version").and_then(Value::as_i64);
    let superseded = requested_version.is_some_and(|version| version != current_version);
    let remote_memo = params.get("remoteMemo").cloned();
    let remote_notebook = params.get("remoteNotebook").cloned();
    let remote_template = params.get("remoteTemplate").cloned();
    let temporary_memo_base = if kind == "memo.create" || kind == "memo.merge" {
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
                if let Some(memo_ids) = payload.get_mut("memoIds").and_then(Value::as_array_mut) {
                    for memo_id in memo_ids {
                        if memo_id.as_str() == Some(entity_id.as_str()) {
                            *memo_id = json!(remote_id);
                        }
                    }
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
                database.execute("UPDATE _edgeever_sidecar_outbox SET entity_id = ?1, payload_json = ?2, version = version + 1,
                  status = CASE WHEN status = 'error' AND last_error_code = 'memo_not_found' THEN 'pending' ELSE status END,
                  retryable = CASE WHEN status = 'error' AND last_error_code = 'memo_not_found' THEN 1 ELSE retryable END,
                  next_attempt_at = CASE WHEN status = 'error' AND last_error_code = 'memo_not_found' THEN NULL ELSE next_attempt_at END
                  WHERE id = ?3", rusqlite::params![next_entity, payload.to_string(), outbox_id]).map_err(|e| e.to_string())?;
            }
            if kind == "memo.create" || kind == "memo.merge" {
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
            let tx = database
                .unchecked_transaction()
                .map_err(|e| e.to_string())?;
            let remote_exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM notebooks WHERE id = ?1)",
                    [&remote_id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            if remote_exists && remote_id != entity_id {
                // The renderer caches the cloud notebook before acknowledging it.
                // Move notes and children before deleting the local placeholder.
                tx.execute(
                    "UPDATE memos SET notebook_id = ?1 WHERE notebook_id = ?2",
                    rusqlite::params![remote_id, entity_id],
                )
                .map_err(|e| e.to_string())?;
                tx.execute(
                    "UPDATE notebooks SET parent_id = ?1 WHERE parent_id = ?2",
                    rusqlite::params![remote_id, entity_id],
                )
                .map_err(|e| e.to_string())?;
                tx.execute("DELETE FROM notebooks WHERE id = ?1", [&entity_id])
                    .map_err(|e| e.to_string())?;
            } else if !remote_exists {
                tx.execute(
                    "UPDATE notebooks SET id = ?1 WHERE id = ?2",
                    rusqlite::params![remote_id, entity_id],
                )
                .map_err(|e| e.to_string())?;
            }
            let mut pending = tx.prepare("SELECT id, entity_id, payload_json FROM _edgeever_sidecar_outbox WHERE id <> ?1").map_err(|e| e.to_string())?;
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
                if let Some(notebook_ids) = payload.get_mut("notebookIds").and_then(Value::as_array_mut) {
                    for notebook_id in notebook_ids {
                        if notebook_id.as_str() == Some(entity_id.as_str()) {
                            *notebook_id = json!(remote_id);
                        }
                    }
                }
                if payload.get("parentId").and_then(Value::as_str) == Some(entity_id.as_str()) {
                    payload["parentId"] = json!(remote_id);
                }
                if payload.get("temporaryId").and_then(Value::as_str) == Some(entity_id.as_str()) {
                    payload["temporaryId"] = json!(remote_id);
                }
                let next_entity = if outbox_entity == entity_id {
                    remote_id.clone()
                } else {
                    outbox_entity
                };
                tx.execute("UPDATE _edgeever_sidecar_outbox SET entity_id = ?1, payload_json = ?2, version = version + 1,
                  status = CASE WHEN status = 'error' AND last_error_code = 'not_found' THEN 'pending' ELSE status END,
                  retryable = CASE WHEN status = 'error' AND last_error_code = 'not_found' THEN 1 ELSE retryable END,
                  next_attempt_at = CASE WHEN status = 'error' AND last_error_code = 'not_found' THEN NULL ELSE next_attempt_at END
                  WHERE id = ?3", rusqlite::params![next_entity, payload.to_string(), outbox_id]).map_err(|e| e.to_string())?;
            }
            drop(pending);
            // Commit the remap and acknowledgement together. Otherwise a crash
            // can leave an already-created notebook queued for another create.
            let deleted = tx.execute(
                "DELETE FROM _edgeever_sidecar_outbox WHERE id = ?1 AND (?2 IS NULL OR version = ?2)",
                rusqlite::params![id, requested_version],
            ).map_err(|e| e.to_string())?;
            tx.commit().map_err(|e| e.to_string())?;
            return Ok(json!({
                "ok": true,
                "superseded": deleted == 0,
                "memo": remote_memo,
                "notebook": remote_notebook,
                "template": remote_template
            }));
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
    let tx = database
        .unchecked_transaction()
        .map_err(|e| e.to_string())?;
    let deleted = if let Some(version) = requested_version {
        tx.execute(
            "DELETE FROM _edgeever_sidecar_outbox WHERE id = ?1 AND version = ?2",
            rusqlite::params![id, version],
        )
        .map_err(|e| e.to_string())?
    } else {
        tx.execute("DELETE FROM _edgeever_sidecar_outbox WHERE id = ?1", [id])
            .map_err(|e| e.to_string())?
    };
    if deleted == 1
        && matches!(
            kind.as_str(),
            "memo.delete" | "memo.deleteBatch" | "memo.emptyTrash"
        )
    {
        let payload: Value = serde_json::from_str(&payload_json).unwrap_or_else(|_| json!({}));
        let memo_ids: Vec<&str> = if kind == "memo.delete" {
            vec![entity_id.as_str()]
        } else {
            payload
                .get("memoIds")
                .and_then(Value::as_array)
                .map(|ids| ids.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default()
        };
        for memo_id in memo_ids {
            // Delete only older conflicted edits after the server accepted the
            // delete. A failed delete must leave its local draft recoverable.
            tx.execute(
                "DELETE FROM _edgeever_sidecar_outbox WHERE kind = 'memo.update' AND entity_id = ?1 AND status = 'conflict' AND id < ?2",
                rusqlite::params![memo_id, id],
            ).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(
        json!({ "ok": true, "superseded": deleted == 0, "memo": remote_memo, "notebook": remote_notebook, "template": remote_template }),
    )
}

pub(crate) fn sync_outbox_fail(database: &Connection, params: &Value) -> Result<Value, String> {
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

pub(crate) fn sync_outbox_retry(database: &Connection, params: &Value) -> Result<Value, String> {
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

pub(crate) fn sync_outbox_recover_memo_update(
    database: &Connection,
    params: &Value,
) -> Result<Value, String> {
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

pub(crate) fn sync_outbox_discard(database: &Connection, params: &Value) -> Result<Value, String> {
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

fn order_sync_change_indices(changes: &[Value]) -> Vec<usize> {
    let mut notebook_upserts = Vec::new();
    let mut notebook_deletes = Vec::new();
    let mut rest = Vec::new();
    for (index, change) in changes.iter().enumerate() {
        let entity_type = change
            .get("entityType")
            .and_then(Value::as_str)
            .unwrap_or("");
        let operation = change
            .get("operation")
            .and_then(Value::as_str)
            .unwrap_or("");
        if entity_type == "notebook" {
            if operation == "delete" {
                notebook_deletes.push(index);
            } else {
                notebook_upserts.push(index);
            }
        } else {
            rest.push(index);
        }
    }

    let mut remaining: std::collections::HashSet<usize> =
        notebook_upserts.iter().copied().collect();
    let mut ordered_upserts = Vec::new();
    while !remaining.is_empty() {
        let ready: Vec<usize> = notebook_upserts
            .iter()
            .copied()
            .filter(|index| remaining.contains(index))
            .filter(|index| {
                let parent_id = changes[*index]
                    .get("notebook")
                    .and_then(|notebook| notebook.get("parentId"))
                    .and_then(Value::as_str);
                match parent_id {
                    Some(parent_id) => !notebook_upserts.iter().copied().any(|candidate| {
                        remaining.contains(&candidate)
                            && changes[candidate].get("entityId").and_then(Value::as_str)
                                == Some(parent_id)
                    }),
                    None => true,
                }
            })
            .collect();
        if ready.is_empty() {
            ordered_upserts.extend(
                notebook_upserts
                    .iter()
                    .copied()
                    .filter(|index| remaining.contains(index)),
            );
            break;
        }
        for index in ready {
            remaining.remove(&index);
            ordered_upserts.push(index);
        }
    }

    ordered_upserts
        .into_iter()
        .chain(notebook_deletes)
        .chain(rest)
        .collect()
}

fn ensure_active_inbox(tx: &Transaction<'_>) -> Result<String, String> {
    if let Some(id) = tx
        .query_row(
            "SELECT id FROM notebooks
             WHERE is_deleted = 0
               AND (slug = 'inbox' OR id = 'nb_inbox' OR id GLOB '*_inbox')
             ORDER BY CASE WHEN slug = 'inbox' THEN 0 WHEN id = 'nb_inbox' THEN 1 ELSE 2 END, id
             LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    {
        return Ok(id);
    }

    if let Some(id) = tx
        .query_row(
            "SELECT id FROM notebooks
             WHERE slug = 'inbox' OR id = 'nb_inbox' OR id GLOB '*_inbox'
             ORDER BY CASE WHEN id = 'nb_inbox' THEN 0 WHEN id GLOB '*_inbox' THEN 1 ELSE 2 END, id
             LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    {
        tx.execute(
            "UPDATE notebooks
             SET is_deleted = 0, deleted_at = NULL, slug = 'inbox', parent_id = NULL,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE id = ?1",
            [&id],
        )
        .map_err(|e| e.to_string())?;
        return Ok(id);
    }

    tx.execute(
        "INSERT INTO notebooks (id, parent_id, name, slug, icon, color, sort_order, created_at, updated_at)
         VALUES ('nb_inbox', NULL, '等待分类', 'inbox', 'notebook', '#0f766e', 10,
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok("nb_inbox".to_owned())
}

pub(crate) fn resolve_active_notebook_id(
    tx: &Transaction<'_>,
    requested_notebook_id: &str,
) -> Result<String, String> {
    let active = tx
        .query_row(
            "SELECT id FROM notebooks WHERE id = ?1 AND is_deleted = 0",
            [requested_notebook_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(id) = active {
        return Ok(id);
    }
    ensure_active_inbox(tx)
}

fn active_inbox_exists_except(tx: &Transaction<'_>, notebook_id: &str) -> Result<bool, String> {
    tx.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM notebooks
           WHERE is_deleted = 0
             AND id <> ?1
             AND (slug = 'inbox' OR id = 'nb_inbox' OR id GLOB '*_inbox')
         )",
        [notebook_id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn notebook_is_active(tx: &Transaction<'_>, notebook_id: &str) -> Result<bool, String> {
    tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM notebooks WHERE id = ?1 AND is_deleted = 0)",
        [notebook_id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn apply_one_sync_change(
    tx: &Transaction<'_>,
    change: &Value,
    rebuilding: bool,
) -> Result<(), String> {
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
            return Ok(());
        }
    }
    if entity_type == "notebook" {
        if operation == "delete" {
            if active_inbox_exists_except(tx, &entity_id)? {
                tx.execute(
                    "UPDATE notebooks
                     SET is_deleted = 1, deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
                     WHERE id = ?1",
                    [&entity_id],
                )
                .map_err(|e| e.to_string())?;
            } else {
                tx.execute("UPDATE notebooks SET is_deleted = 1, deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1 AND slug <> 'inbox' AND id <> 'nb_inbox' AND id NOT GLOB '*_inbox'", [&entity_id]).map_err(|e| e.to_string())?;
            }
            return Ok(());
        }
        let notebook = change
            .get("notebook")
            .ok_or_else(|| "Missing notebook change payload".to_owned())?;
        let requested_slug = notebook.get("slug").and_then(Value::as_str);
        let inbox = is_inbox_notebook(&entity_id, requested_slug);
        let requested_parent = notebook
            .get("parentId")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty() && !inbox);
        let parent_id = if let Some(parent_id) = requested_parent {
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM notebooks WHERE id = ?1)",
                    [parent_id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            exists.then_some(parent_id)
        } else {
            None
        };
        let slug = if inbox { Some("inbox") } else { requested_slug };
        let keep_inactive = inbox
            && active_inbox_exists_except(tx, &entity_id)?
            && !notebook_is_active(tx, &entity_id)?;
        let is_deleted = i64::from(keep_inactive);
        tx.execute("INSERT INTO notebooks (id, parent_id, name, slug, icon, color, sort_order, created_at, updated_at, is_deleted, deleted_at, color_target, is_bold, icon_inverted, text_color, row_inverted) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, CASE WHEN ?10 = 1 THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END, ?11, ?12, ?13, ?14, ?15) ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id, name=excluded.name, slug=excluded.slug, icon=excluded.icon, color=excluded.color, color_target=excluded.color_target, is_bold=excluded.is_bold, icon_inverted=excluded.icon_inverted, row_inverted=excluded.row_inverted, text_color=excluded.text_color, sort_order=excluded.sort_order, updated_at=excluded.updated_at, is_deleted=excluded.is_deleted, deleted_at=excluded.deleted_at", rusqlite::params![entity_id, parent_id, string_param(notebook, "name")?, slug, notebook.get("icon").and_then(Value::as_str), notebook.get("color").and_then(Value::as_str), notebook.get("sortOrder").and_then(Value::as_i64).unwrap_or(0), string_param(notebook, "createdAt")?, string_param(notebook, "updatedAt")?, is_deleted, notebook.get("colorTarget").and_then(Value::as_str).unwrap_or("icon"), i64::from(notebook.get("isBold").and_then(Value::as_bool).unwrap_or(false)), i64::from(notebook.get("iconInverted").and_then(Value::as_bool).unwrap_or(false)), notebook.get("textColor").and_then(Value::as_str), i64::from(notebook.get("rowInverted").and_then(Value::as_bool).unwrap_or(false))]).map_err(|e| e.to_string())?;
        return Ok(());
    }
    if operation == "delete" {
        tx.execute("UPDATE memos SET is_deleted = 1, deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1", [&entity_id]).map_err(|e| e.to_string())?;
        return Ok(());
    }
    let memo = change
        .get("memo")
        .ok_or_else(|| "Missing memo change payload".to_owned())?;
    let tags = memo
        .get("tags")
        .cloned()
        .unwrap_or_else(|| json!([]))
        .to_string();
    let source_memo_ids = memo
        .get("sourceMemoIds")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let source_ids = Value::Array(source_memo_ids.clone()).to_string();
    let requested_merge_target = memo.get("mergedIntoMemoId").and_then(Value::as_str);
    // Bootstrap pages are ordered by memo id, not by merge dependency. A
    // deleted source can therefore arrive before the merged memo it
    // references. Cache the source without the unresolved foreign key;
    // the target's sourceMemoIds backfills it when that page arrives.
    let merge_target = if let Some(target_id) = requested_merge_target {
        let target_exists = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM memos WHERE id = ?1)",
                [target_id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|e| e.to_string())?;
        target_exists.then_some(target_id)
    } else {
        None
    };
    let content_json = memo
        .get("contentJson")
        .cloned()
        .unwrap_or_else(|| json!({"type":"doc","content":[]}));
    let requested_notebook_id = string_param(memo, "notebookId")?;
    let notebook_id = resolve_active_notebook_id(tx, &requested_notebook_id)?;
    tx.execute("INSERT INTO memos (id, notebook_id, title, excerpt, tags_json, is_pinned, is_archived, is_deleted, source_memo_ids, merge_source_count, merged_into_memo_id, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14) ON CONFLICT(id) DO UPDATE SET notebook_id=excluded.notebook_id, title=excluded.title, excerpt=excluded.excerpt, tags_json=excluded.tags_json, is_pinned=excluded.is_pinned, is_archived=excluded.is_archived, is_deleted=excluded.is_deleted, source_memo_ids=excluded.source_memo_ids, merge_source_count=excluded.merge_source_count, merged_into_memo_id=excluded.merged_into_memo_id, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at", rusqlite::params![entity_id, notebook_id, memo.get("title").and_then(Value::as_str), string_param(memo, "excerpt")?, tags, memo.get("isPinned").and_then(Value::as_bool).unwrap_or(false) as i64, memo.get("isArchived").and_then(Value::as_bool).unwrap_or(false) as i64, memo.get("isDeleted").and_then(Value::as_bool).unwrap_or(false) as i64, source_ids, memo.get("mergeSourceCount").and_then(Value::as_i64).unwrap_or(0), merge_target, string_param(memo, "createdAt")?, string_param(memo, "updatedAt")?, memo.get("deletedAt").and_then(Value::as_str)]).map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO memo_contents (memo_id, content_json, content_markdown, content_text, content_hash, revision) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(memo_id) DO UPDATE SET content_json=excluded.content_json, content_markdown=excluded.content_markdown, content_text=excluded.content_text, content_hash=excluded.content_hash, revision=excluded.revision, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')", rusqlite::params![entity_id, content_json.to_string(), string_param(memo, "contentMarkdown")?, string_param(memo, "contentText")?, string_param(memo, "contentHash")?, memo.get("revision").and_then(Value::as_i64).unwrap_or(0)]).map_err(|e| e.to_string())?;
    for source_id in source_memo_ids.iter().filter_map(Value::as_str) {
        tx.execute(
            "UPDATE memos SET merged_into_memo_id = ?1 WHERE id = ?2",
            rusqlite::params![entity_id, source_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(crate) fn apply_sync_changes(database: &Connection, params: &Value) -> Result<Value, String> {
    let changes = params
        .get("changes")
        .and_then(Value::as_array)
        .ok_or_else(|| "Missing changes array".to_owned())?;
    let rebuilding = meta_value(database, SYNC_BOOTSTRAP_RESET_KEY).as_deref() == Some("1");
    let ordered = order_sync_change_indices(changes);
    let tx = database
        .unchecked_transaction()
        .map_err(|e| e.to_string())?;
    for index in ordered {
        apply_one_sync_change(&tx, &changes[index], rebuilding)?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(json!({ "applied": changes.len() }))
}
