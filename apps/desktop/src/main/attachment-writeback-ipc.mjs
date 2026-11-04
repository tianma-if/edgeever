export const registerAttachmentWritebackIpc = (ipcMain, { manager, authorize, getScope, reveal }) => {
  const authorizeScope = event => {
    authorize(event);
    const scope = getScope();
    return () => {
      authorize(event);
      if (getScope() !== scope) throw new Error("Attachment account changed");
    };
  };
  ipcMain.handle("desktop:attachment-writebacks", async event => {
    const assertCurrent = authorizeScope(event);
    const items = await manager.list();
    assertCurrent();
    return items;
  });
  ipcMain.handle("desktop:retry-attachment-writeback", async (event, id) => {
    const assertCurrent = authorizeScope(event);
    if (typeof id !== "string") return;
    await manager.retry(id);
    assertCurrent();
    void manager.tick().catch(() => {});
  });
  ipcMain.handle("desktop:reveal-attachment-writeback", async (event, id) => {
    const assertCurrent = authorizeScope(event);
    if (typeof id !== "string") return;
    const path = await manager.filePath(id);
    assertCurrent();
    if (path) reveal(path);
  });
};
