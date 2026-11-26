CREATE TABLE ee_table_memo_receipts (
  workspace_id TEXT NOT NULL,
  table_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),
  PRIMARY KEY (workspace_id, table_id, actor, mutation_id),
  FOREIGN KEY (workspace_id, table_id) REFERENCES ee_table_heads(workspace_id,table_id) ON DELETE CASCADE
);
