import { contextBridge, ipcRenderer } from 'electron';
import type { AppSnapshot, UsageSnapshot } from './shared/types';

contextBridge.exposeInMainWorld('codexSwitch', {
  getState: (): Promise<AppSnapshot> => ipcRenderer.invoke('state:get'),
  getUsage: (): Promise<UsageSnapshot> => ipcRenderer.invoke('usage:get'),
  saveAccount: (name: string, force = false): Promise<AppSnapshot> => ipcRenderer.invoke('account:save', name, force),
  switchAccount: (name: string): Promise<AppSnapshot> => ipcRenderer.invoke('account:switch', name),
  removeAccount: (name: string): Promise<AppSnapshot> => ipcRenderer.invoke('account:remove', name),
  renameAccount: (oldName: string, newName: string): Promise<AppSnapshot> => ipcRenderer.invoke('account:rename', oldName, newName),
  resetForAdd: (name: string): Promise<AppSnapshot> => ipcRenderer.invoke('account:add-reset', name)
});
