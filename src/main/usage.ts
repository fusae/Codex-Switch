import { spawn } from 'child_process';
import https from 'https';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { UsageSnapshot } from '../shared/types';
import { accessToken } from './codexStore';

const usageUrls = [
  'https://chatgpt.com/backend-api/codex/usage',
  'https://chatgpt.com/backend-api/wham/usage',
  'https://chatgpt.com/api/codex/usage',
  'https://chatgpt.com/wham/usage'
];

type RateLimitWindow = {
  used_percent?: number;
  usedPercent?: number;
  window_minutes?: number;
  windowDurationMins?: number;
  resets_at?: number;
  resetsAt?: number;
};

type RateLimits = {
  limit_id?: string | null;
  limitId?: string | null;
  primary?: RateLimitWindow | null;
  secondary?: RateLimitWindow | null;
  credits?: unknown;
  plan_type?: string | null;
  planType?: string | null;
  rate_limit_reached_type?: string | null;
  rateLimitReachedType?: string | null;
};

type AppServerResponse = {
  id?: number;
  result?: {
    rateLimits?: RateLimits;
    rateLimitsByLimitId?: Record<string, RateLimits>;
  };
  error?: { message?: string };
};

function requestJson(url: string, token: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      timeout: 8000,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': 'Codex-Switch'
      }
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${url} 返回 ${res.statusCode}: ${body.slice(0, 160)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve({ raw: body });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`${url} 超时`));
    });
    req.on('error', reject);
    req.end();
  });
}

function collect(value: unknown, path = ''): string[] {
  const needles = ['remaining', 'limit', 'used', 'usage', 'credit', 'percent', 'reset', 'window'];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collect(item, `${path}[${index}]`));
  }
  if (!value || typeof value !== 'object') return [];

  const output: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = path ? `${path}.${key}` : key;
    const lower = key.toLowerCase();
    const primitive = child === null || ['string', 'number', 'boolean'].includes(typeof child);
    if (primitive && needles.some((needle) => lower.includes(needle))) {
      output.push(`${nextPath}: ${String(child)}`);
    }
    output.push(...collect(child, nextPath));
  }
  return output;
}

function walkJsonlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const output: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) output.push(...walkJsonlFiles(path));
    if (entry.isFile() && entry.name.endsWith('.jsonl')) output.push(path);
  }
  return output;
}

function minutesLabel(minutes?: number): string {
  if (!minutes) return '未知窗口';
  if (minutes % 1440 === 0) return `${minutes / 1440}天窗口`;
  if (minutes % 60 === 0) return `${minutes / 60}小时窗口`;
  return `${minutes}分钟窗口`;
}

function resetLabel(seconds?: number): string {
  if (!seconds) return '未知';
  return new Date(seconds * 1000).toLocaleString();
}

function windowLine(label: string, value?: RateLimitWindow | null): string | null {
  if (!value) return null;
  const usedPercent = value.used_percent ?? value.usedPercent;
  const resetsAt = value.resets_at ?? value.resetsAt;
  const remaining = typeof usedPercent === 'number' ? `${Math.max(0, 100 - usedPercent)}%` : '未知';
  const used = typeof usedPercent === 'number' ? `${usedPercent}%` : '未知';
  return `${label}  剩余 ${remaining} · 已用 ${used} · ${resetLabel(resetsAt)}`;
}

function formatCredits(credits: unknown): string {
  if (credits === null || credits === undefined) return '未返回';
  if (typeof credits === 'string' || typeof credits === 'number' || typeof credits === 'boolean') return String(credits);
  if (typeof credits === 'object' && credits && 'balance' in credits) return String((credits as { balance?: unknown }).balance ?? '未返回');
  return JSON.stringify(credits);
}

function extractRateLimits(line: string): RateLimits | null {
  if (!line.includes('rate_limits') && !line.includes('rateLimits')) return null;
  try {
    const event = JSON.parse(line) as Record<string, unknown>;
    const payload = event.payload as Record<string, unknown> | undefined;
    if (event.type !== 'event_msg' || payload?.type !== 'token_count') return null;
    const direct = payload?.rate_limits || payload?.rateLimits;
    const nested = (payload?.info as Record<string, unknown> | undefined)?.rate_limits;
    const rateLimits = (direct || nested || null) as RateLimits | null;
    if (!rateLimits || (rateLimits.limit_id ?? rateLimits.limitId) !== 'codex') return null;
    if (!rateLimits.primary && !rateLimits.secondary) return null;
    return rateLimits;
  } catch {
    return null;
  }
}

function formatRateLimits(rateLimits: RateLimits, source: string, refreshedAt = Date.now()): UsageSnapshot {
  const linesOut = [
    windowLine('5小时', rateLimits.primary),
    windowLine('7天', rateLimits.secondary),
    `计划 ${rateLimits.plan_type ?? rateLimits.planType ?? '未知'} · Credits ${formatCredits(rateLimits.credits)}`
  ].filter((line): line is string => Boolean(line));

  return {
    ok: true,
    summary: linesOut.join('\n'),
    details: JSON.stringify(rateLimits, null, 2),
    source,
    refreshedAt
  };
}

function fetchFromAppServer(): Promise<UsageSnapshot> {
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
      done(() => reject(new Error('app-server usage 查询超时')));
    }, 10000);

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
          done(() => reject(new Error(message.error?.message || 'app-server usage 查询失败')));
          return;
        }
        const rateLimits = message.result?.rateLimitsByLimitId?.codex || message.result?.rateLimits;
        if (!rateLimits) {
          done(() => reject(new Error('app-server 没返回 codex rate limits')));
          return;
        }
        done(() => resolve(formatRateLimits(rateLimits, 'app-server')));
      }
    });

    child.on('error', (error) => {
      done(() => reject(error));
    });
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
      method: 'account/rateLimits/read',
      params: null
    }) + '\n');
  });
}

function readLocalUsage(): UsageSnapshot | null {
  const sessionsDir = join(homedir(), '.codex', 'sessions');
  const files = walkJsonlFiles(sessionsDir)
    .map((file) => ({ file, mtime: statSync(file).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 20);

  for (const { file, mtime } of files) {
    const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const rateLimits = extractRateLimits(lines[index]);
      if (!rateLimits) continue;
      return formatRateLimits(rateLimits, 'local-sessions', mtime);
    }
  }

  return null;
}

export async function fetchUsage(): Promise<UsageSnapshot> {
  try {
    return await fetchFromAppServer();
  } catch {
    const local = readLocalUsage();
    if (local) return { ...local, source: 'local-sessions-stale' };
  }

  const token = accessToken();
  if (!token) return { ok: false, summary: '缺少 access_token', error: 'missing access token' };

  let lastError: Error | null = null;
  for (const url of usageUrls) {
    try {
      const data = await requestJson(url, token);
      const hits = collect(data).slice(0, 8);
      return {
        ok: true,
        summary: hits.length ? hits.join('\n') : '已获取 usage，字段待适配',
        details: JSON.stringify(data, null, 2),
        source: url,
        refreshedAt: Date.now()
      };
    } catch (error) {
      lastError = error as Error;
    }
  }

  return {
    ok: false,
    summary: `Usage 不可用：${lastError?.message || 'unknown error'}`,
    error: lastError?.message,
    refreshedAt: Date.now()
  };
}
