use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::catalog::{
    cache_resource, cache_template, create_notebook, create_template, delete_cached_resource,
    delete_notebook, delete_template, list_notebooks, list_resources, list_tags, list_templates,
    restore_notebook, rewrite_tag, update_notebook, update_template,
};
use crate::database::{backup_database, list_backups, restore_database};
use crate::memo::{
    cache_memo_revision, create_memo, delete_memo, delete_memos, empty_trash, list_memo_revisions,
    list_memos, memo_value, merge_memos, move_memos, pin_memos, restore_memo,
    restore_memo_revision, update_memo,
};
use crate::sync::{
    apply_sync_changes, prepare_sync_bootstrap, sync_outbox_ack, sync_outbox_discard,
    sync_outbox_fail, sync_outbox_list, sync_outbox_recover_memo_update, sync_outbox_retry,
    sync_status, SYNC_BOOTSTRAP_RESET_KEY,
};
use crate::{bool_param, set_meta, string_param};

pub(crate) const PROTOCOL_VERSION: i64 = 2;

#[derive(Debug, Deserialize)]
pub(crate) struct RpcRequest {
    pub(crate) id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
pub(crate) struct RpcError<'a> {
    pub(crate) code: &'a str,
    pub(crate) message: String,
}

pub(crate) fn handle(
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
