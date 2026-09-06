PRAGMA foreign_keys = ON;

-- Shared, runtime-neutral leases prevent overlapping destructive maintenance
-- such as public Demo resets without relying on Cloudflare-only primitives.
CREATE TABLE maintenance_leases (
  name TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Replace the content-owning FTS table with an external-content index. The
-- ordinary table provides a UNIQUE memo lookup and one authoritative search
-- document per active memo; FTS5 keeps only its inverted index.
DROP TABLE memos_fts;

CREATE TABLE memo_search_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memo_id TEXT NOT NULL UNIQUE,
  title TEXT,
  content_text TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (memo_id) REFERENCES memos(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

INSERT INTO memo_search_documents (memo_id, title, content_text, tags)
SELECT
  m.id,
  m.title,
  c.content_text,
  COALESCE((
    SELECT group_concat(value, ' ')
    FROM json_each(m.tags_json)
  ), '')
FROM memos m
INNER JOIN memo_contents c ON c.memo_id = m.id
WHERE m.is_deleted = 0;

CREATE VIRTUAL TABLE memos_fts USING fts5(
  memo_id UNINDEXED,
  title,
  content_text,
  tags,
  content = 'memo_search_documents',
  content_rowid = 'id'
);

INSERT INTO memos_fts(memos_fts) VALUES('rebuild');

-- Keep triggers on one physical line for remote D1 compatibility.
CREATE TRIGGER trg_memo_search_documents_insert AFTER INSERT ON memo_search_documents BEGIN INSERT INTO memos_fts (rowid, memo_id, title, content_text, tags) VALUES (NEW.id, NEW.memo_id, NEW.title, NEW.content_text, NEW.tags); END;
CREATE TRIGGER trg_memo_search_documents_delete AFTER DELETE ON memo_search_documents BEGIN INSERT INTO memos_fts (memos_fts, rowid, memo_id, title, content_text, tags) VALUES ('delete', OLD.id, OLD.memo_id, OLD.title, OLD.content_text, OLD.tags); END;
CREATE TRIGGER trg_memo_search_documents_update AFTER UPDATE ON memo_search_documents BEGIN INSERT INTO memos_fts (memos_fts, rowid, memo_id, title, content_text, tags) VALUES ('delete', OLD.id, OLD.memo_id, OLD.title, OLD.content_text, OLD.tags); INSERT INTO memos_fts (rowid, memo_id, title, content_text, tags) VALUES (NEW.id, NEW.memo_id, NEW.title, NEW.content_text, NEW.tags); END;
