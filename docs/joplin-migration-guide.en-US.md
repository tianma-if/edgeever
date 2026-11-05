# Joplin Migration Guide

[简体中文](note-migration-guide.md) | [English](note-migration-guide.en-US.md)

> 💡 **Notice**: All third-party note migration guides have been merged and updated into a unified guide:
> 👉 **[Migrate from Third-Party Notes to EdgeEver: The Complete Guide](note-migration-guide.en-US.md)** (covering native GUI one-click import and AI Agent / MCP migration).

EdgeEver natively supports importing your entire Joplin knowledge base. In either the Web app or the Electron desktop client, **no converter plugins or custom scripts are needed**. You can migrate Joplin JEX archives, RAW export folders, or Markdown directories directly into EdgeEver via an intuitive graphical interface.

---

### Native Import Features

- **Broad Format Support**:
  - **JEX Format (.jex)**: Joplin's native TAR archive containing all notes, metadata, and resource attachments.
  - **RAW Export Folder**: Joplin's raw structure directory or its `.zip` archive.
  - **Markdown Export**: Supports Markdown directories exported with Front Matter and their `.zip` archives.
- **Full Notebook Hierarchy**: Reconstructs nested notebook trees faithfully from Joplin's parent-child notebook relationships.
- **Tags & Timestamp Retention**: Maps Joplin tag relations accurately and retains original creation and modification dates.
- **Resource & Attachment Transfer**: Resolves internal Joplin resource IDs (e.g., `:/abcdef123456...`), uploads local images, PDFs, and attachments to EdgeEver's secure resource store, and rewrites body links cleanly.
- **Local Preflight Scanning**: Parses archives locally in your browser or desktop environment, providing a clear preflight summary before any write.

---

### Migration Steps

#### Step 1: Export Notes from Joplin

1. Open the Joplin desktop client.
2. Click **File → Export all** in the top menu bar.
3. Choose the export format:
   - **Recommended**: Select **JEX - Joplin Export File** to produce a single `.jex` archive.
   - **Alternative**: Select **RAW - Joplin Export Directory** or **MD - Markdown (with Front Matter)**, then compress the exported directory into a `.zip` archive.

#### Step 2: Open the Import Dialog in EdgeEver

1. Open EdgeEver in your web browser or desktop client and sign in.
2. Click the **Settings** gear icon at the bottom of the left sidebar.
3. In the **Import and export** section, locate the **Import from other apps** card and click **Start import**.

#### Step 3: Choose Source and Add Files

1. In the import dialog, select **Joplin** under Source app.
2. Add your exported data:
   - **Drag and Drop**: Drag the `.jex` file, RAW folder, or `.zip` archive directly into the dashed dropzone area.
   - **Browse**: Click **Choose files** to pick a `.jex` or `.zip` file, or click **Choose folder** to select a RAW/Markdown export directory.

#### Step 4: Local Preflight & Target Selection

1. EdgeEver rapidly unpacks and scans notes, tags, and resources locally in the background.
2. Review the preflight summary:
   - Projected counts of **Notebooks**, **Notes**, and **Attachments**.
   - Tree view of the detected notebook hierarchy.
   - Formatting alerts or unlinked resources (if any).
3. Under "Import into", choose to **Create top-level notebooks** (default) or place them beneath an existing parent notebook.

#### Step 5: Confirm and Stream Import

1. After confirming the preflight details, click **Confirm import** in the bottom-right corner.
2. EdgeEver streams and parses notes and attachments locally:
   - The UI shows real-time progress, processed item counts, and current file names.
   - Desktop sync is safely paused during execution and resumed upon completion.

#### Step 6: Verify Imported Notes

1. Once the import completes, review the finished notes list. Click **Open note** to verify text content, images, and tags.
2. If any attachment was interrupted by network timeouts, click **Retry unfinished steps** to resume without creating duplicate notes.
