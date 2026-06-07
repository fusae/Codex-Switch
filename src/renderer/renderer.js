const api = window.codexSwitch;

const els = {
  status: document.getElementById('status-line'),
  refresh: document.getElementById('refresh'),
  usageBtn: document.getElementById('usage-btn'),
  usage: document.getElementById('usage-box'),
  usagePrimary: document.getElementById('usage-primary'),
  usagePrimarySub: document.getElementById('usage-primary-sub'),
  usageSecondary: document.getElementById('usage-secondary'),
  usageSecondarySub: document.getElementById('usage-secondary-sub'),
  usagePlan: document.getElementById('usage-plan'),
  usageMeta: document.getElementById('usage-meta'),
  statusActions: document.getElementById('status-actions'),
  accounts: document.getElementById('accounts'),
  count: document.getElementById('count'),
  message: document.getElementById('message')
};

function fmtTime(ms) {
  if (!ms) return 'missing';
  return new Date(ms).toLocaleString();
}

function fmtShortTime(ms) {
  if (!ms) return '未刷新';
  return new Date(ms).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function setMessage(text) {
  els.message.textContent = text || '';
}

async function refresh() {
  try {
    const state = await api.getState();
    render(state);
    setMessage('');
  } catch (error) {
    setMessage(error.message || String(error));
  }
}

let usageLoading = false;
let lastState = null;
let editingAccount = null;

function getUsedPercent(bucket) {
  const value = bucket?.usedPercent ?? bucket?.used_percent;
  return typeof value === 'number' ? Math.round(value) : null;
}

function getResetAt(bucket) {
  const value = bucket?.resetsAt ?? bucket?.resets_at;
  return typeof value === 'number' ? value * 1000 : null;
}

function getCredits(credits) {
  if (credits === null || credits === undefined) return '未返回';
  if (typeof credits === 'object' && 'balance' in credits) return credits.balance ?? '未返回';
  return credits;
}

function applyUsageTone(el, remaining) {
  el.className = 'usage-value';
  if (remaining === null) return;
  if (remaining < 20) el.classList.add('bad');
  else if (remaining < 50) el.classList.add('warn');
  else el.classList.add('good');
}

function renderMetric(valueEl, subEl, label, bucket) {
  const used = getUsedPercent(bucket);
  const remaining = used === null ? null : Math.max(0, 100 - used);
  valueEl.textContent = remaining === null ? '--' : `${remaining}%`;
  applyUsageTone(valueEl, remaining);

  const resetAt = getResetAt(bucket);
  const resetText = resetAt ? new Date(resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '未知';
  subEl.textContent = `${label} · 已用 ${used === null ? '--' : `${used}%`} · ${resetText} 重置`;
}

function renderUsage(usage) {
  let details = null;
  try {
    details = usage.details ? JSON.parse(usage.details) : null;
  } catch {
    details = null;
  }

  if (details?.primary || details?.secondary) {
    renderMetric(els.usagePrimary, els.usagePrimarySub, '5小时', details.primary);
    renderMetric(els.usageSecondary, els.usageSecondarySub, '7天', details.secondary);
    const plan = details.planType ?? details.plan_type ?? '未知';
    els.usagePlan.textContent = `计划 ${plan} · Credits ${getCredits(details.credits)}`;
    return;
  }

  els.usagePrimary.textContent = usage.ok ? '--' : '失败';
  els.usageSecondary.textContent = '--';
  els.usagePrimarySub.textContent = usage.summary || '未返回额度';
  els.usageSecondarySub.textContent = '等待下一次刷新';
  els.usagePlan.textContent = usage.error || '计划 -- · Credits --';
  applyUsageTone(els.usagePrimary, null);
  applyUsageTone(els.usageSecondary, null);
}

async function refreshUsage() {
  if (usageLoading) return;
  usageLoading = true;
  els.usageBtn.disabled = true;
  try {
    const usage = await api.getUsage();
    renderUsage(usage);
    const at = usage.refreshedAt ? new Date(usage.refreshedAt).toLocaleTimeString() : new Date().toLocaleTimeString();
    els.usageMeta.textContent = `${usage.source || 'unknown'} · ${at}`;
    if (!usage.ok && usage.error) setMessage(usage.error);
  } catch (error) {
    renderUsage({ ok: false, summary: `不可用：${error.message || String(error)}`, error: error.message || String(error) });
    els.usageMeta.textContent = new Date().toLocaleTimeString();
  } finally {
    els.usageBtn.disabled = false;
    usageLoading = false;
  }
}

function render(state) {
  lastState = state;
  const s = state.status;
  renderCurrentStatus(state);
  const switchableAccounts = state.accounts.filter((account) => account.accountId !== s.currentAccountId);
  els.count.textContent = `${switchableAccounts.length} 个`;
  els.accounts.innerHTML = '';

  if (!switchableAccounts.length) {
    const empty = document.createElement('div');
    empty.className = 'account-row';
    empty.textContent = state.accounts.length ? '没有其他可切换账号' : '暂无账号快照';
    els.accounts.appendChild(empty);
    return;
  }

  for (const account of switchableAccounts) {
    const row = document.createElement('div');
    row.className = 'account-row';

    const info = document.createElement('div');
    info.className = 'account-info';
    const name = document.createElement('div');
    name.className = 'account-name';
    name.textContent = account.name;
    const id = document.createElement('div');
    id.className = 'account-id';
    id.textContent = `${account.accountId} · ${fmtTime(account.modifiedAt)}`;
    const refresh = document.createElement('div');
    refresh.className = `account-refresh ${account.refreshStatus || 'unknown'}`;
    if (account.refreshStatus === 'failed') {
      refresh.textContent = `需重新登录 · ${fmtShortTime(account.lastRefreshAt)}`;
      if (account.refreshError) refresh.title = account.refreshError;
    } else if (account.refreshStatus === 'ok') {
      refresh.textContent = `凭证正常 · ${fmtShortTime(account.lastRefreshAt)}`;
    } else {
      refresh.textContent = '等待刷新';
    }
    info.append(name, id, refresh);

    const actions = document.createElement('div');
    actions.className = 'account-actions';
    const useBtn = document.createElement('button');
    useBtn.textContent = '切换';
    useBtn.className = 'small primary';
    useBtn.onclick = () => run(() => api.switchAccount(account.name), `已切换到 ${account.name}，正在重启 Codex`);
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '删除';
    removeBtn.className = 'small danger';
    removeBtn.onclick = () => run(() => api.removeAccount(account.name), `已删除 ${account.name}`);
    actions.append(useBtn, removeBtn);

    row.append(info, actions);
    els.accounts.appendChild(row);
  }
}

function renderCurrentStatus(state) {
  const s = state.status;
  const currentName = s.activeName;
  els.statusActions.innerHTML = '';

  if (editingAccount === currentName && currentName) {
    const input = document.createElement('input');
    input.className = 'rename-input status-rename-input';
    input.value = currentName;
    input.onkeydown = (event) => {
      if (event.key === 'Enter') commitRename(currentName, input.value);
      if (event.key === 'Escape') cancelRename();
    };
    els.status.replaceChildren(input);

    const saveBtn = document.createElement('button');
    saveBtn.textContent = '保存';
    saveBtn.className = 'small primary';
    saveBtn.onclick = () => commitRename(currentName, input.value);
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.className = 'small';
    cancelBtn.onclick = cancelRename;
    els.statusActions.append(saveBtn, cancelBtn);

    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
    return;
  }

  els.status.textContent = `${currentName || '未保存'} · ${s.currentAccountId}`;
  if (s.cookiesNewerThanAuth) {
    els.status.textContent += ' · Cookies 已更新';
  }

  if (currentName) {
    const renameBtn = document.createElement('button');
    renameBtn.textContent = '改名';
    renameBtn.className = 'small';
    renameBtn.onclick = () => startRename(currentName);
    els.statusActions.append(renameBtn);
  }
}

async function run(fn, okMessage) {
  try {
    const state = await fn();
    render(state);
    setMessage(okMessage);
    refreshUsage();
  } catch (error) {
    setMessage(error.message || String(error));
  }
}

function startRename(name) {
  editingAccount = name;
  if (lastState) render(lastState);
}

function cancelRename() {
  editingAccount = null;
  if (lastState) render(lastState);
}

function commitRename(oldName, nextName) {
  const cleaned = String(nextName || '').trim();
  if (!cleaned || cleaned === oldName) {
    cancelRename();
    return;
  }
  editingAccount = null;
  run(() => api.renameAccount(oldName, cleaned), `已改名为 ${cleaned}`);
}

els.refresh.onclick = refresh;
els.usageBtn.onclick = refreshUsage;

refresh();
refreshUsage();
setInterval(refresh, 30000);
setInterval(refreshUsage, 30000);
