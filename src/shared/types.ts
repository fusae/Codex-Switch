export type AccountSnapshot = {
  name: string;
  accountId: string;
  modifiedAt: number;
  refreshStatus?: 'ok' | 'failed' | 'unknown';
  lastRefreshAt?: number;
  refreshError?: string;
};

export type StatusSnapshot = {
  currentAccountId: string;
  activeName: string | null;
  authFileMtime: number | null;
  cookiesMtime: number | null;
  cookiesNewerThanAuth: boolean;
};

export type UsageSnapshot = {
  ok: boolean;
  summary: string;
  details?: string;
  error?: string;
  source?: string;
  refreshedAt?: number;
};

export type AppSnapshot = {
  accounts: AccountSnapshot[];
  status: StatusSnapshot;
};
