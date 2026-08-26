use rusqlite::{backup::Backup, Connection, DatabaseName};
use serde_json::{json, Value};
use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

fn string_param(params: &Value, key: &str) -> Result<String, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| format!("Missing string parameter: {key}"))
}

pub(crate) fn data_dir() -> PathBuf {
    let args: Vec<String> = env::args().collect();
    args.windows(2)
        .find(|pair| pair[0] == "--data-dir")
        .map(|pair| PathBuf::from(&pair[1]))
        .unwrap_or_else(|| PathBuf::from(".edgeever-desktop"))
}

pub(crate) fn migrations_dir() -> PathBuf {
    let args: Vec<String> = env::args().collect();
    args.windows(2)
        .find(|pair| pair[0] == "--migrations-dir")
        .map(|pair| PathBuf::from(&pair[1]))
        .unwrap_or_else(|| PathBuf::from("migrations"))
}

fn restrict_directory(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        let mut permissions = fs::metadata(path)?.permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(path, permissions)?;
    }
    Ok(())
}

fn restrict_file(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        if path.exists() {
            let mut permissions = fs::metadata(path)?.permissions();
            permissions.set_mode(0o600);
            fs::set_permissions(path, permissions)?;
        }
    }
    Ok(())
}

fn apply_migrations(connection: &Connection, migrations: &Path) -> rusqlite::Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS _edgeever_migrations (
           name TEXT PRIMARY KEY,
           applied_at TEXT NOT NULL
         );",
    )?;

    let mut files: Vec<PathBuf> = fs::read_dir(migrations)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?
        .filter_map(|entry| entry.ok().map(|item| item.path()))
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("sql"))
        .collect();
    files.sort();

    for path in files {
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        let already_applied: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM _edgeever_migrations WHERE name = ?1)",
            [name],
            |row| row.get(0),
        )?;
        if already_applied {
            continue;
        }

        let sql = fs::read_to_string(&path)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(&sql)?;
        transaction.execute(
            "INSERT INTO _edgeever_migrations (name, applied_at) VALUES (?1, datetime('now'))",
            [name],
        )?;
        transaction.commit()?;
    }
    Ok(())
}

fn ensure_sidecar_schema(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS _edgeever_sidecar_meta (
           key TEXT PRIMARY KEY,
           value TEXT NOT NULL,
           updated_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS _edgeever_sidecar_outbox (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           kind TEXT NOT NULL,
           entity_id TEXT NOT NULL,
           payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
           status TEXT NOT NULL DEFAULT 'pending',
           attempt_count INTEGER NOT NULL DEFAULT 0,
           last_error TEXT,
           version INTEGER NOT NULL DEFAULT 1,
           created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
           updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         );
         CREATE INDEX IF NOT EXISTS idx_sidecar_outbox_status ON _edgeever_sidecar_outbox(status, id);",
    )?;

    let has_version = connection
        .prepare("PRAGMA table_info(_edgeever_sidecar_outbox)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?
        .iter()
        .any(|name| name == "version");
    if !has_version {
        connection.execute(
            "ALTER TABLE _edgeever_sidecar_outbox ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
            [],
        )?;
    }
    Ok(())
}

fn copy_directory(source: &Path, destination: &Path) -> io::Result<()> {
    if !source.exists() {
        return Ok(());
    }
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if source_path.is_dir() {
            copy_directory(&source_path, &destination_path)?;
        } else {
            fs::copy(source_path, destination_path)?;
        }
    }
    Ok(())
}

pub(crate) fn backup_database(connection: &Connection, root: &Path) -> rusqlite::Result<PathBuf> {
    let backup_dir = root.join("backups");
    fs::create_dir_all(&backup_dir)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    restrict_directory(&backup_dir)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    let backup_path = backup_dir.join(format!(
        "edgeever-{}.sqlite",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ));
    let backup_path_text = backup_path.to_string_lossy().to_string();
    connection.execute("VACUUM INTO ?1", [&backup_path_text])?;
    restrict_file(&backup_path)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    let resource_backup = backup_path.with_extension("resources");
    fs::remove_dir_all(&resource_backup).ok();
    copy_directory(&root.join("resource-outbox"), &resource_backup)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    let mut backups: Vec<PathBuf> = fs::read_dir(&backup_dir)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?
        .filter_map(|entry| entry.ok().map(|item| item.path()))
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.starts_with("edgeever-") && name.ends_with(".sqlite"))
                .unwrap_or(false)
        })
        .collect();
    backups.sort();
    while backups.len() > 5 {
        if let Some(oldest) = backups.first() {
            fs::remove_file(oldest)
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
            fs::remove_dir_all(oldest.with_extension("resources")).ok();
        }
        backups.remove(0);
    }
    Ok(backup_path)
}

pub(crate) fn list_backups(root: &Path) -> rusqlite::Result<Value> {
    let backup_dir = root.join("backups");
    fs::create_dir_all(&backup_dir)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    let mut backups = Vec::new();
    for entry in fs::read_dir(&backup_dir)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?
    {
        let path = entry
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?
            .path();
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_owned();
        if !name.starts_with("edgeever-") || !name.ends_with(".sqlite") {
            continue;
        }
        let metadata = fs::metadata(&path)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_secs().to_string())
            .unwrap_or_default();
        backups.push(json!({ "path": path.to_string_lossy(), "name": name, "size": metadata.len(), "modifiedAt": modified_at }));
    }
    backups.sort_by(|left, right| {
        right
            .get("name")
            .and_then(Value::as_str)
            .cmp(&left.get("name").and_then(Value::as_str))
    });
    Ok(json!({ "backups": backups }))
}

pub(crate) fn restore_database(
    database: &mut Connection,
    root: &Path,
    migrations: &Path,
    params: &Value,
) -> Result<Value, String> {
    let requested = string_param(params, "path")?;
    let backup_dir = root
        .join("backups")
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let backup_path = PathBuf::from(requested)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if backup_path.parent() != Some(backup_dir.as_path())
        || backup_path.extension().and_then(|value| value.to_str()) != Some("sqlite")
    {
        return Err("Backup path must point to a managed EdgeEver backup".to_owned());
    }

    // Windows refuses to rotate/delete a backup while a read connection still
    // holds the managed file open. Restore from a temporary copy so retention
    // can safely remove the selected snapshot when it is the oldest one.
    let source_copy = root.join(".edgeever-restore-source.sqlite");
    fs::remove_file(&source_copy).ok();
    fs::copy(&backup_path, &source_copy).map_err(|error| error.to_string())?;
    let source = Connection::open(&source_copy).map_err(|error| error.to_string())?;
    // A protective backup rotates the five-file retention window. Preserve the
    // selected snapshot's resource companion before that rotation can remove
    // it when the user restores the oldest retained backup.
    let resource_backup = backup_path.with_extension("resources");
    let resource_restore_source = root.join("resource-outbox.restore-source");
    fs::remove_dir_all(&resource_restore_source).ok();
    if resource_backup.is_dir() {
        copy_directory(&resource_backup, &resource_restore_source)
            .map_err(|error| error.to_string())?;
    }
    // Open the selected snapshot before rotation: if it is the oldest of the
    // five retained files, the protective backup may remove its directory
    // entry while this read-only connection keeps the snapshot available.
    let protective_backup = backup_database(&*database, root).map_err(|error| error.to_string())?;
    let backup = Backup::new_with_names(&source, DatabaseName::Main, database, DatabaseName::Main)
        .map_err(|error| error.to_string())?;
    backup
        .run_to_completion(100, Duration::from_millis(5), None)
        .map_err(|error| error.to_string())?;
    drop(backup);
    drop(source);
    fs::remove_file(&source_copy).map_err(|error| error.to_string())?;
    apply_migrations(database, migrations).map_err(|error| error.to_string())?;
    ensure_sidecar_schema(database).map_err(|error| error.to_string())?;
    let resource_source = if resource_restore_source.is_dir() {
        resource_restore_source.as_path()
    } else {
        resource_backup.as_path()
    };
    if resource_source.is_dir() {
        let restored_resources = root.join("resource-outbox.restore");
        fs::remove_dir_all(&restored_resources).ok();
        copy_directory(resource_source, &restored_resources).map_err(|error| error.to_string())?;
        fs::remove_dir_all(root.join("resource-outbox")).ok();
        fs::rename(restored_resources, root.join("resource-outbox"))
            .map_err(|error| error.to_string())?;
    }
    fs::remove_dir_all(&resource_restore_source).ok();
    Ok(json!({ "ok": true, "path": protective_backup }))
}

pub(crate) fn open_database(root: &Path, migrations: &Path) -> rusqlite::Result<Connection> {
    fs::create_dir_all(root)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    restrict_directory(root)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    let existed = root.join("edgeever.sqlite").exists();
    let connection = Connection::open(root.join("edgeever.sqlite"))?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    ensure_sidecar_schema(&connection)?;
    if existed {
        backup_database(&connection, root)?;
    }
    apply_migrations(&connection, migrations)?;
    for path in [
        root.join("edgeever.sqlite"),
        root.join("edgeever.sqlite-wal"),
        root.join("edgeever.sqlite-shm"),
    ] {
        restrict_file(&path)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    }
    Ok(connection)
}
