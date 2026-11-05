# Evernote Migration Guide

[简体中文](evernote-migration-guide.md) | [English](evernote-migration-guide.en-US.md)

EdgeEver provides native, out-of-the-box support for importing third-party notes. In either the Web app or the Electron desktop client, **no extra dependencies, command-line operations, or MCP configurations are required**. You can directly drag or select files exported from Evernote to migrate your notes into EdgeEver seamlessly.

---

### Native Import Features

- **Lossless Content Preservation**: Full support for titles, rich-text styling, tables, task lists, colors, and blockquotes.
- **Timestamp & Metadata Restoration**: Accurately preserves original creation (`Created`) and update (`Updated`) timestamps, with note tags fully migrated.
- **Notebook Hierarchy**: Supports single or multiple `.enex` files, folders containing multiple ENEX files, or `.zip` archives, restoring the notebook structure as intended.
- **Media & Resource Attachments**: Embedded images, audio clips, PDFs, and other attachments are safely decoded locally in the client and streamed to the EdgeEver resource store.
- **Client-Side Preflight Inspection**: Parses files locally in your browser or desktop environment before import. Inspect counts of notebooks, notes, attachments, and potential warnings without uploading unverified raw archives to the server.

---

### Migration Steps (Recommended: Native One-Click Import)

#### Step 1: Export Notes from Evernote

1. Open the Evernote desktop client.
2. In the left notebook sidebar, right-click the notebook you wish to export and choose **Export Notebook...** (or select multiple notes, right-click, and choose **Export Notes...**).
3. Ensure the export format is set to **ENEX format (.enex)**:
   - Check all metadata options, including tags, created date, and updated date.
   - > ⚠️ **Notice**: Certain Mac clients default to `.notes` format; make sure to select `.enex` in the export dialog.
4. **Batch Export Tip**: If you have multiple notebooks, export each one as an individual `.enex` file and place them in a single folder, or bundle them into a `.zip` archive.

#### Step 2: Open the Import Dialog in EdgeEver

1. Open EdgeEver in your web browser or desktop client and sign in.
2. Click the **Settings** gear icon at the bottom of the left sidebar.
3. In the **Import and export** section, locate the **Import from other apps** card and click **Start import**.

#### Step 3: Choose Source and Add Files

1. In the import dialog, select **Evernote / 印象笔记** under Source app.
2. Add your exported files using either convenient option:
   - **Drag and Drop**: Drag one or more `.enex` files, a folder, or a `.zip` archive directly into the dashed dropzone area.
   - **Browse**: Click **Choose files** to pick `.enex` or `.zip` files, or click **Choose folder** to select a directory containing ENEX files.

#### Step 4: Local Preflight & Target Selection

1. Once selected, EdgeEver will quickly inspect the data locally in the background.
2. Review the preflight summary:
   - The projected number of **Notebooks**, **Notes**, and **Attachments**.
   - A tree preview of the detected notebook structure.
   - Any non-blocking warnings (such as oversized attachments or formatting notes).
3. Under "Import into", choose whether to **Create top-level notebooks** (default) or import them under an existing parent notebook.

#### Step 5: Confirm and Stream Import

1. After reviewing the preflight summary, click **Confirm import** in the bottom-right corner.
2. EdgeEver parses the data locally in chunks, creating notes and streaming attachments one by one:
   - Real-time progress indicators show current processing files and completion status.
   - On the desktop client, background sync is paused safely and resumed automatically upon completion, refreshing the workspace cleanly.

#### Step 6: Verify Imported Notes

1. Once the import finishes, the dialog displays a list of results.
2. Click **Open note** next to any item in the list to inspect formatting, images, and timestamps.
3. If any step was interrupted by temporary network instability, click **Retry unfinished steps** to resume without duplicating notes that have already been created.

---

### Advanced Alternative: Automation Scripts & MCP for Huge Archives

If your knowledge base spans tens of thousands of notes or tens of gigabytes, or if you prefer running automated sync on a headless server, you can also use command-line tooling and MCP:

1. **Automated Export**: Use the open-source tool `pipx install evernote-backup`, run `evernote-backup init` and `evernote-backup sync` to dump all notebooks to local disk.
2. **MCP / Script Import**: Refer to the script [`scripts/import-evernote-enex-via-mcp.mjs`](https://github.com/tianma-if/edgeever/blob/main/scripts/import-evernote-enex-via-mcp.mjs) in this repository and connect it via EdgeEver's Remote MCP service for automated batch migration.
