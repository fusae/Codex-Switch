import { execFile, spawn } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import type { AccountSnapshot, AppSnapshot, StatusSnapshot } from '../shared/types';

type CodexAuth = {
  auth_mode?: string;
  tokens?: {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
};

type AppServerResponse = {
  id?: number;
  result?: unknown;
  error?: { message?: string };
};

const home = homedir();
const storeDir = process.env.CODEX_SWITCH_HOME || join(home, '.codex-switch');
const accountsDir = join(storeDir, 'accounts');
const backupsDir = join(storeDir, 'backups');
const activeFile = join(storeDir, 'active');

const authFile = join(home, '.codex', 'auth.json');
const codexAppDir = join(home, 'Library', 'Application Support', 'Codex');
const cookiesFile = join(codexAppDir, 'Cookies');
const cookiesJournalFile = join(codexAppDir, 'Cookies-journal');
const activeRefreshIntervalMs = 30 * 60 * 1000;

let activeRefreshRunning = false;

type RefreshState = {
  status: 'ok' | 'failed';
  at: number;
  error?: string;
};

function ensureDirs(): void {
  mkdirSync(accountsDir, { recursive: true });
  mkdirSync(backupsDir, { recursive: true });
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function validateName(name: string): string {
  const cleaned = name.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(cleaned)) {
    throw new Error('账号名只能包含字母、数字、点、下划线和横线');
  }
  return cleaned;
}

function copyIfExists(src: string, dst: string): void {
  if (!existsSync(src)) return;
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
}

function moveIfExists(src: string, dst: string): void {
  if (!existsSync(src)) return;
  mkdirSync(dirname(dst), { recursive: true });
  rmSync(dst, { force: true });
  renameSync(src, dst);
}

function readAuth(file = authFile): CodexAuth | null {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as CodexAuth;
}

function accountIdFor(file = authFile): string {
  return readAuth(file)?.tokens?.account_id || 'unknown';
}

function accountDir(name: string): string {
  return join(accountsDir, name);
}

function refreshStateFile(name: string): string {
  return join(accountDir(name), 'refresh.json');
}

function autoAccountName(accountId: string): string {
  const base = `account-${accountId.slice(0, 8)}`;
  let name = base;
  let index = 2;
  while (existsSync(accountDir(name))) {
    name = `${base}-${index}`;
    index += 1;
  }
  return name;
}

function fileMtime(file: string): number | null {
  if (!existsSync(file)) return null;
  return statSync(file).mtimeMs;
}

function readRefreshState(name: string): RefreshState | null {
  const file = refreshStateFile(name);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as RefreshState;
  } catch {
    return null;
  }
}

function writeRefreshState(name: string, state: RefreshState): void {
  mkdirSync(accountDir(name), { recursive: true });
  writeFileSync(refreshStateFile(name), JSON.stringify(state, null, 2));
}

function markRefreshOk(name: string): void {
  writeRefreshState(name, { status: 'ok', at: Date.now() });
}

function markRefreshFailed(name: string, error: unknown): void {
  writeRefreshState(name, {
    status: 'failed',
    at: Date.now(),
    error: error instanceof Error ? error.message : String(error)
  });
}

function runAppCommand(command: 'open' | 'quit'): void {
  if (command === 'open') {
    execFile('open', ['-a', 'Codex'], () => undefined);
    return;
  }
  execFile('osascript', ['-e', 'tell application "Codex" to quit'], () => undefined);
}

function isCodexRunning(callback: (running: boolean) => void): void {
  execFile('pgrep', ['-x', 'Codex'], (error) => callback(!error));
}

function openCodexAfterQuit(): void {
  let attempts = 0;
  const tick = (): void => {
    attempts += 1;
    isCodexRunning((running) => {
      if (!running || attempts >= 15) {
        runAppCommand('open');
        return;
      }
      setTimeout(tick, 250);
    });
  };
  setTimeout(tick, 350);
}

function appServerRequest(method: string, params: unknown, timeoutMs = 10000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn('/Applications/Codex.app/Contents/Resources/codex', ['app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'ignore']
    });
    let output = '';
    let settled = false;

    const done = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      fn();
    };

    const timer = setTimeout(() => {
      done(() => reject(new Error('刷新凭证超时')));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const lines = output.split('\n');
      output = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let message: AppServerResponse;
        try {
          message = JSON.parse(line) as AppServerResponse;
        } catch {
          continue;
        }
        if (message.id !== 2) continue;
        if (message.error) {
          const errorMessage = message.error.message || '刷新凭证失败';
          done(() => reject(new Error(errorMessage)));
          return;
        }
        done(() => resolve(message.result));
      }
    });

    child.on('error', (error) => done(() => reject(error)));
    child.on('exit', (code) => {
      if (!settled && code !== 0) done(() => reject(new Error(`app-server 退出：${code}`)));
    });

    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'Codex Switch', version: '0.2.0' },
        capabilities: {}
      }
    }) + '\n');
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method,
      params
    }) + '\n');
  });
}

async function refreshLiveAuth(): Promise<void> {
  await appServerRequest('account/read', { refreshToken: true });
}

export function snapshot(): AppSnapshot {
  ensureDirs();
  return {
    accounts: listAccounts(),
    status: status()
  };
}

export function listAccounts(): AccountSnapshot[] {
  ensureDirs();
  return readdirSync(accountsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const file = join(accountsDir, entry.name, 'auth.json');
      if (!existsSync(file)) return null;
      const refreshState = readRefreshState(entry.name);
      const refreshStatus: AccountSnapshot['refreshStatus'] = refreshState?.status || 'unknown';
      const snapshot: AccountSnapshot = {
        name: entry.name,
        accountId: accountIdFor(file),
        modifiedAt: statSync(file).mtimeMs,
        refreshStatus,
        lastRefreshAt: refreshState?.at,
        refreshError: refreshState?.error
      };
      return snapshot;
    })
    .filter((item): item is AccountSnapshot => Boolean(item))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function status(): StatusSnapshot {
  const authMtime = fileMtime(authFile);
  const cookiesMtime = fileMtime(cookiesFile);
  return {
    currentAccountId: accountIdFor(),
    activeName: existsSync(activeFile) ? readFileSync(activeFile, 'utf8').trim() || null : null,
    authFileMtime: authMtime,
    cookiesMtime,
    cookiesNewerThanAuth: Boolean(authMtime && cookiesMtime && cookiesMtime > authMtime)
  };
}

export function syncCurrentAccount(): string | null {
  ensureDirs();
  if (!existsSync(authFile)) return null;

  const currentId = accountIdFor();
  if (!currentId || currentId === 'unknown') return null;

  const existing = listAccounts().find((account) => account.accountId === currentId);
  const name = existing?.name || autoAccountName(currentId);
  writeSnapshot(name);
  writeFileSync(activeFile, `${name}\n`);
  return name;
}

export function saveCurrent(name: string, force = false): void {
  ensureDirs();
  const cleaned = validateName(name);
  if (!existsSync(authFile)) throw new Error('缺少 ~/.codex/auth.json');
  const currentId = accountIdFor();

  if (!force) {
    const duplicate = listAccounts().find((account) => account.name !== cleaned && account.accountId === currentId);
    if (duplicate) throw new Error(`当前 account_id 已保存为 ${duplicate.name}，如需覆盖请强制保存`);
  }

  writeSnapshot(cleaned);
  writeFileSync(activeFile, `${cleaned}\n`);
}

function writeSnapshot(name: string): void {
  const dir = accountDir(name);
  mkdirSync(dir, { recursive: true });
  copyIfExists(authFile, join(dir, 'auth.json'));
  copyIfExists(cookiesFile, join(dir, 'Cookies'));
  copyIfExists(cookiesJournalFile, join(dir, 'Cookies-journal'));
}

function backupCurrent(prefix = timestamp()): void {
  if (!existsSync(authFile)) return;
  const dir = join(backupsDir, prefix);
  mkdirSync(dir, { recursive: true });
  copyIfExists(authFile, join(dir, 'auth.json'));
  copyIfExists(cookiesFile, join(dir, 'Cookies'));
  copyIfExists(cookiesJournalFile, join(dir, 'Cookies-journal'));
}

export async function switchTo(name: string): Promise<void> {
  ensureDirs();
  const cleaned = validateName(name);
  const dir = accountDir(cleaned);
  if (!existsSync(join(dir, 'auth.json'))) throw new Error(`账号不存在：${cleaned}`);

  const active = status().activeName;
  if (active && existsSync(accountDir(active))) {
    try {
      writeSnapshot(active);
    } catch {
      // Ignore active refresh failures; switching should still work from saved snapshots.
    }
  }

  runAppCommand('quit');
  backupCurrent();
  copyIfExists(join(dir, 'auth.json'), authFile);
  copyIfExists(join(dir, 'Cookies'), cookiesFile);
  copyIfExists(join(dir, 'Cookies-journal'), cookiesJournalFile);
  writeFileSync(activeFile, `${cleaned}\n`);

  try {
    await refreshLiveAuth();
    writeSnapshot(cleaned);
    markRefreshOk(cleaned);
  } catch (error) {
    markRefreshFailed(cleaned, error);
    openCodexAfterQuit();
    throw new Error(`已切换到 ${cleaned}，但凭证刷新失败：${error instanceof Error ? error.message : String(error)}`);
  }

  openCodexAfterQuit();
}

export function resetForAdd(name: string): void {
  ensureDirs();
  const cleaned = validateName(name);
  runAppCommand('quit');
  const dir = join(backupsDir, `add-${cleaned}-${timestamp()}`);
  mkdirSync(dir, { recursive: true });
  moveIfExists(authFile, join(dir, 'auth.json'));
  moveIfExists(cookiesFile, join(dir, 'Cookies'));
  moveIfExists(cookiesJournalFile, join(dir, 'Cookies-journal'));
  openCodexAfterQuit();
}

export function removeAccount(name: string): void {
  const cleaned = validateName(name);
  rmSync(accountDir(cleaned), { recursive: true, force: true });
  if (status().activeName === cleaned) rmSync(activeFile, { force: true });
}

export function renameAccount(oldName: string, newName: string): void {
  ensureDirs();
  const from = validateName(oldName);
  const to = validateName(newName);
  if (from === to) return;
  if (!existsSync(accountDir(from))) throw new Error(`账号不存在：${from}`);
  if (existsSync(accountDir(to))) throw new Error(`账号名已存在：${to}`);
  renameSync(accountDir(from), accountDir(to));
  if (status().activeName === from) writeFileSync(activeFile, `${to}\n`);
}

export function accessToken(): string | null {
  return readAuth()?.tokens?.access_token || null;
}

export async function refreshActiveAccountIfDue(force = false): Promise<void> {
  if (activeRefreshRunning) return;
  const active = status().activeName;
  if (!active || !existsSync(accountDir(active))) return;
  const refreshState = readRefreshState(active);
  if (!force && refreshState?.at && Date.now() - refreshState.at < activeRefreshIntervalMs) return;

  activeRefreshRunning = true;
  try {
    await refreshLiveAuth();
    writeSnapshot(active);
    markRefreshOk(active);
  } catch (error) {
    markRefreshFailed(active, error);
  } finally {
    activeRefreshRunning = false;
  }
}
