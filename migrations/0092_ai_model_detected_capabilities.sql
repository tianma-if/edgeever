-- Limits a client read from the model provider (#652). All columns are optional:
-- NULL means "not detected yet", and the budget falls back to the previous behaviour.
ALTER TABLE ai_models ADD COLUMN detected_max_output_tokens INTEGER;
ALTER TABLE ai_models ADD COLUMN detected_max_input_tokens INTEGER;
ALTER TABLE ai_models ADD COLUMN detected_context_window_tokens INTEGER;
ALTER TABLE ai_models ADD COLUMN detected_capability_source TEXT;
ALTER TABLE ai_models ADD COLUMN detected_at TEXT;
