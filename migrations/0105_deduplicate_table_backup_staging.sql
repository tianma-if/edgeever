CREATE TABLE ee_table_restore_values (
  job_id TEXT NOT NULL REFERENCES ee_table_restore_jobs(id) ON DELETE CASCADE,
  value_hash TEXT NOT NULL,
  cells_json TEXT NOT NULL CHECK(json_valid(cells_json)),
  PRIMARY KEY(job_id, value_hash)
);

ALTER TABLE ee_table_restore_rows ADD COLUMN value_hash TEXT;
CREATE INDEX ee_table_restore_rows_value ON ee_table_restore_rows(job_id, value_hash);
