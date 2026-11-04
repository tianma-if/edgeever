-- Optional per-model output budgets (#652). NULL keeps the built-in default
-- for that scenario, so existing models behave exactly as before.
ALTER TABLE ai_models ADD COLUMN generation_max_output_tokens INTEGER;
ALTER TABLE ai_models ADD COLUMN tag_suggestion_max_output_tokens INTEGER;
ALTER TABLE ai_models ADD COLUMN companion_max_output_tokens INTEGER;
