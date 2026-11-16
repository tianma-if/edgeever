# Migrating flomo notes

[简体中文](flomo-migration-guide.md)

1. In flomo Web or desktop, open **Settings → Account details**, scroll to the bottom, and click the global export button and download the HTML ZIP.
2. In EdgeEver, open **Profile → Backup and import → Import from other apps**, choose **flomo**, and select the original ZIP (or extracted folder).
3. Review preflight results and choose a destination. Confirmation creates a new `flomo` notebook there. Resolve preflight errors before selecting the files again.
4. Hiding the dialog does not stop the task; reopen it to view progress. Runtime failures retain written data. Use the same task's **Retry unfinished steps** to continue without recreating completed notes.

**Selecting the ZIP again starts a new task and creates all notes again, including repeated imports of the same ZIP.** No cross-task deduplication or overwriting occurs. Export times lack a timezone and use the importing device's current system timezone. Missing modification times retain the unified import warning and import-time behavior.

Keep the original archive until content, tags, times and attachments are verified. See the [complete migration guide](note-migration-guide.en-US.md) for the unified flow, limits and optional MCP migration.
