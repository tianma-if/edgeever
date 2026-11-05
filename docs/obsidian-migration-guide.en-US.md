# Obsidian Migration Guide

[简体中文](note-migration-guide.md) | [English](note-migration-guide.en-US.md)

> 💡 **Notice**: All third-party note migration guides have been merged and updated into a unified guide:
> 👉 **[Migrate from Third-Party Notes to EdgeEver: The Complete Guide](note-migration-guide.en-US.md)** (covering native GUI one-click import and AI Agent / MCP migration).

EdgeEver natively supports importing your entire Obsidian knowledge base (Vault). In either the Web app or the Electron desktop client, **no manual format conversion, command-line tools, or custom scripts are needed**. You can migrate an Obsidian Vault folder or ZIP archive into EdgeEver seamlessly through a graphical interface.

---

### Native Import Features

- **Folder Hierarchy Restoration**: Automatically generates nested EdgeEver notebooks matching your Vault directory structure to preserve your existing organization.
- **Front Matter Metadata Parsing**: Reads YAML Front Matter for `title`, `tags`, creation time (`created` / `createdAt`), and updated time (`updated` / `updatedAt`) to keep historical timestamps and tags accurate.
- **Automatic Attachment & Image Uploads**:
  - Supports standard Markdown image syntax: `![alt](relative/path/image.png)`.
  - Supports Obsidian native wiki embed syntax: `![[image.png]]` or `![[attachment.pdf]]`.
  - Media files are resolved and uploaded to EdgeEver's secure resource store, with body references seamlessly updated.
- **Clean & Safe Filtering**: Automatically ignores internal Obsidian configuration folders (`.obsidian`), version control (`.git`), trash (`.trash`), and OS hidden files.
- **Client-Side Streaming**: Processing occurs entirely in your local browser or desktop environment without uploading unverified archives to the server.

---

### Migration Steps

#### Step 1: Prepare Your Obsidian Vault Data

You can prepare your data in one of two ways:
- **Option A (Recommended): Select Vault folder directly**. Locate your local Obsidian Vault folder on disk.
- **Option B: Compress as a ZIP archive**. If migrating from a remote browser or uploading as a bundle, compress your Obsidian Vault directory into a `.zip` file.

#### Step 2: Open the Import Dialog in EdgeEver

1. Open EdgeEver in your web browser or desktop client and sign in.
2. Click the **Settings** gear icon at the bottom of the left sidebar.
3. In the **Import and export** section, locate the **Import from other apps** card and click **Start import**.

#### Step 3: Choose Source and Load Vault

1. In the import dialog, select **Obsidian** under Source app.
2. Add your Vault data:
   - **Drag and Drop**: Drag the Vault folder or `.zip` file directly into the dashed dropzone area.
   - **Browse**: Click **Choose folder** to select your local Vault directory, or click **Choose files** to select a `.zip` archive.

#### Step 4: Local Preflight & Target Selection

1. EdgeEver scans Markdown files and referenced media locally in the background.
2. Review the preflight summary:
   - Projected counts of **Notebooks**, **Notes**, and **Attachments**.
   - Tree view of the detected notebook hierarchy.
   - Warnings regarding ambiguous references or missing attachments (if any).
3. Under "Import into", choose to **Create top-level notebooks** (default) or place them beneath an existing parent notebook.

#### Step 5: Confirm and Stream Import

1. After confirming the preflight details, click **Confirm import** in the bottom-right corner.
2. EdgeEver streams and parses notes and attachments locally:
   - The UI shows real-time progress, processed item counts, and current file names.
   - Desktop sync is safely coordinated during execution and resumed upon completion.

#### Step 6: Verify Imported Notes

1. Once the import completes, review the finished notes list. Click **Open note** to verify text content, images, and tags.
2. If any attachment was interrupted by network timeouts, click **Retry unfinished steps** to resume without creating duplicate notes.
