DELETE FROM scheduled_task_runs
WHERE started_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days');
