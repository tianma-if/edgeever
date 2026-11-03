// Keep paths and saved credentials in the main process. Renderers receive status only.
export const registerBackupIpc = ({ ipcMain, manager, getWindow, dialog, shell }) => {
  ipcMain.handle("desktop:backup", async (event, action, input) => {
    if (event.sender !== getWindow()?.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error("Backup requests must come from the main frame");
    try {
      const checkScope = () => {
        if (!input?.backupSetId || input.backupSetId !== manager.status()?.backupSetId) throw Object.assign(new Error("The backup account changed. Review the current target and try again."), { code: "backup_account_changed" });
      };
      if (action !== "status") checkScope();
      let value;
      switch (action) {
        case "status": value = manager.status(); break;
        case "save": value = await manager.save(input?.config, input?.password, input.backupSetId); void manager.tick(); break;
        case "choose-directory": {
          const result = await dialog.showOpenDialog(getWindow(), { properties: ["openDirectory", "createDirectory"], defaultPath: manager.status()?.config.directory });
          checkScope();
          value = result.canceled ? null : await manager.approveDirectory(result.filePaths[0]); break;
        }
        case "run": value = await manager.run(input?.password, input.backupSetId, undefined, input?.options); break;
        case "cancel": await manager.cancel(); value = manager.status(); break;
        case "open-folder": {
          const status = manager.status(); if (!status) throw Object.assign(new Error("Sign in first"), { code: "backup_login_required" });
          const error = await shell.openPath(await manager.openFolderPath(input.backupSetId)); if (error) throw Object.assign(new Error(error), { code: "backup_directory_invalid" });
          value = true; break;
        }
        case "choose-import": {
          const result = await dialog.showOpenDialog(getWindow(), { properties: ["openFile"], defaultPath: manager.status()?.actualDirectory, filters: [{ name: "EdgeEver backup", extensions: ["zip", "enc"] }, { name: "All files", extensions: ["*"] }] });
          checkScope();
          value = result.canceled ? null : await manager.selectImport(result.filePaths[0]); break;
        }
        case "select-history": value = await manager.selectHistory(input?.name, input.backupSetId); break;
        case "delete-history": value = await manager.deleteHistory(input?.name, input.backupSetId); break;
        case "prepare-import": value = await manager.prepareImport(input?.id, input?.password); break;
        case "confirm-import": manager.confirmImport(); value = manager.status(); break;
        case "offsite-save": value = await manager.saveOffsite(input?.config, input?.password, input.backupSetId); void manager.tick(); break;
        case "offsite-test": value = await manager.testOffsite(input?.config, input?.password, input.backupSetId); break;
        case "offsite-upload": value = manager.uploadOffsiteNow(input.backupSetId); break;
        default: throw Object.assign(new Error("Unknown backup action"), { code: "backup_invalid_action" });
      }
      if (action !== "status") checkScope();
      return { ok: true, value };
    } catch (error) { return { ok: false, error: { code: error.code ?? "backup_failed", message: error.message } }; }
  });
};
