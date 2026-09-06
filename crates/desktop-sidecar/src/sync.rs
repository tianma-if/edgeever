use rusqlite::Connection;
use serde_json::{json, Value};

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

pub(crate) fn apply_sync_changes(database: &Connection, params: &Value) -> Result<Value, String> {
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
