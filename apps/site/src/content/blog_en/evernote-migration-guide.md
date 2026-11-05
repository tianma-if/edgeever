---
draft: false
title: "How to migrate from Evernote to a self-hosted notes app: EdgeEver ENEX guide"
snippet: "Use EdgeEver's native import features to smoothly migrate all notes, attachments, timestamps, and nested notebooks from Evernote."
image: {
    src: "/images/evernote-migration.jpg",
    alt: "Migrating from Evernote to EdgeEver"
}
publishDate: "2026-07-02 01:00"
category: "Migration"
author: "EdgeEver Team"
tags: [evernote, migration, self-hosted, import]
---

> EdgeEver is not affiliated with, endorsed by, or sponsored by Evernote. This guide only explains how users can migrate data they own into EdgeEver. Evernote is a trademark of its respective owner.

EdgeEver provides native, out-of-the-box support for importing third-party notes. In either the Web app or the Electron desktop client, **no extra dependencies, command-line operations, or MCP configurations are required**. You can directly drag or select files exported from Evernote to migrate your notes into EdgeEver seamlessly.

If you are still comparing self-hosted Evernote alternatives, start with the [EdgeEver category page](/en/self-hosted-evernote-alternative), then follow the steps below.

### FAQ

- **Does this keep notebooks, attachments, and timestamps?** Yes. The native import preserves note titles, rich-text styling, tables, checklists, and accurately retains original creation and modification dates alongside multi-level notebook hierarchies. Attached images and media files are safely streamed to EdgeEver's resource store.
- **Do I need technical skills or terminal commands?** No. Simply click "Settings → Import and export → Import from other apps" in EdgeEver, drag in your `.enex` files or ZIP archive, and click to import.
- **Is EdgeEver affiliated with Evernote?** No. This guide only covers data you already own.

---

### Step 1: Export Notes from Evernote

1. Open the Evernote desktop client.
2. In the left notebook sidebar, right-click the notebook you wish to export and choose **Export Notebook...** (or select multiple notes, right-click, and choose **Export Notes...**).
3. Ensure the export format is set to **ENEX format (.enex)**:
   - Check all metadata options, including tags, created date, and updated date.
   - Certain Mac clients default to `.notes` format; make sure to select `.enex` in the export dialog.
4. **Batch Export**: If you have multiple notebooks, export each one as an individual `.enex` file and place them in a single folder, or bundle them into a `.zip` archive.

---

### Step 2: Open the Import Dialog in EdgeEver

1. Open EdgeEver in your web browser or desktop client and sign in.
2. Click the **Settings** gear icon at the bottom of the left sidebar.
3. In the **Import and export** section, locate the **Import from other apps** card and click **Start import**.

---

### Step 3: Choose Source and Add Files

1. In the import dialog, select **Evernote / 印象笔记** under Source app.
2. Add your exported files:
   - **Drag and Drop**: Drag one or more `.enex` files, a folder, or a `.zip` archive directly into the dashed dropzone area.
   - **Browse**: Click **Choose files** to pick `.enex` or `.zip` files, or click **Choose folder** to select a directory containing ENEX files.

---

### Step 4: Local Preflight & Confirm Import

1. The client scans files locally in the background and presents a preflight summary with projected notebook, note, and attachment counts alongside a structure preview.
2. Under "Import into", choose whether to **Create top-level notebooks** (default) or import them under an existing parent notebook.
3. Click **Confirm import** in the bottom-right corner. EdgeEver parses the data locally in chunks, creating notes and streaming attachments one by one.
4. Once finished, click **Open note** next to any item in the results list to inspect content, images, and timestamps. Click **Retry unfinished steps** if any network interruption occurred.

---

### Advanced Alternative: Automation Scripts & MCP for Huge Archives

If your knowledge base spans tens of thousands of notes or tens of gigabytes, or if you prefer running automated sync on a headless server, you can also use command-line tooling and MCP:

1. **Automated Export**: Use the open-source tool `pipx install evernote-backup`, run `evernote-backup init` and `evernote-backup sync` to dump all notebooks to local disk.
2. **MCP / Script Import**: Refer to the script [`scripts/import-evernote-enex-via-mcp.mjs`](https://github.com/tianma-if/edgeever/blob/main/scripts/import-evernote-enex-via-mcp.mjs) in this repository and connect it via EdgeEver's Remote MCP service for automated batch migration.
