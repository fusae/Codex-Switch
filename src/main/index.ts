import { app, ipcMain } from 'electron';
import { createTray } from './tray';
import { fetchUsage } from './usage';
import { refreshActiveAccountIfDue, removeAccount, renameAccount, resetForAdd, saveCurrent, snapshot, switchTo, syncCurrentAccount } from './codexStore';

app.setName('Codex Switch');
if (process.platform === 'darwin') {
  app.dock.hide();
}

ipcMain.handle('state:get', () => {
  syncCurrentAccount();
  return snapshot();
});
ipcMain.handle('usage:get', () => fetchUsage());
ipcMain.handle('account:save', (_event, name: string, force: boolean) => {
  saveCurrent(name, force);
  return snapshot();
});
ipcMain.handle('account:switch', async (_event, name: string) => {
  await switchTo(name);
  return snapshot();
});
ipcMain.handle('account:remove', (_event, name: string) => {
  removeAccount(name);
  return snapshot();
});
ipcMain.handle('account:rename', (_event, oldName: string, newName: string) => {
  renameAccount(oldName, newName);
  return snapshot();
});
ipcMain.handle('account:add-reset', (_event, name: string) => {
  resetForAdd(name);
  return snapshot();
});

app.whenReady().then(() => {
  syncCurrentAccount();
  refreshActiveAccountIfDue(true);
  setInterval(() => {
    try {
      syncCurrentAccount();
    } catch {
      // Ignore transient auth writes while Codex is refreshing login state.
    }
  }, 5000);
  setInterval(() => {
    refreshActiveAccountIfDue();
  }, 5 * 60 * 1000);
  createTray();
});

app.on('window-all-closed', (event: Event) => {
  event.preventDefault();
});
