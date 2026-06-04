import type { AppSnapshot, UsageSnapshot } from '../shared/types';

declare global {
  interface Window {
    codexSwitch: {
      getState(): Promise<AppSnapshot>;
      getUsage(): Promise<UsageSnapshot>;
      saveAccount(name: string, force?: boolean): Promise<AppSnapshot>;
      switchAccount(name: string): Promise<AppSnapshot>;
      removeAccount(name: string): Promise<AppSnapshot>;
      renameAccount(oldName: string, newName: string): Promise<AppSnapshot>;
      resetForAdd(name: string): Promise<AppSnapshot>;
    };
  }
}
