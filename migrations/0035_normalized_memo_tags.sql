PRAGMA foreign_keys = ON;

CREATE TABLE memo_tags (
  memo_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  PRIMARY KEY (memo_id, name),
  FOREIGN KEY (memo_id) REFERENCES memos(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX idx_memo_tags_workspace_name
  ON memo_tags(workspace_id, normalized_name, memo_id);

INSERT INTO memo_tags (memo_id, workspace_id, name, normalized_name)
SELECT m.id, m.workspace_id, trim(CAST(tag.value AS TEXT)), lower(trim(CAST(tag.value AS TEXT)))
FROM memos m, json_each(m.tags_json) AS tag
WHERE trim(CAST(tag.value AS TEXT)) <> '';

-- Keep triggers on one physical line for remote D1 compatibility.
CREATE TRIGGER trg_memo_tags_insert AFTER INSERT ON memos WHEN json_array_length(NEW.tags_json) > 0 BEGIN INSERT OR IGNORE INTO memo_tags (memo_id, workspace_id, name, normalized_name) SELECT NEW.id, NEW.workspace_id, trim(CAST(value AS TEXT)), lower(trim(CAST(value AS TEXT))) FROM json_each(NEW.tags_json) WHERE trim(CAST(value AS TEXT)) <> ''; END;
CREATE TRIGGER trg_memo_tags_update AFTER UPDATE OF tags_json, workspace_id ON memos WHEN OLD.tags_json <> NEW.tags_json OR OLD.workspace_id <> NEW.workspace_id BEGIN DELETE FROM memo_tags WHERE memo_id = NEW.id; INSERT OR IGNORE INTO memo_tags (memo_id, workspace_id, name, normalized_name) SELECT NEW.id, NEW.workspace_id, trim(CAST(value AS TEXT)), lower(trim(CAST(value AS TEXT))) FROM json_each(NEW.tags_json) WHERE trim(CAST(value AS TEXT)) <> ''; END;
