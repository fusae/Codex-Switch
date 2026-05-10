# Codex Switch

快速保存和切换 Codex Desktop / Codex CLI 的账号登录态。

## 用法

```bash
./codex-switch save main
./codex-switch save main --force
./codex-switch add work
./codex-switch save work
./codex-switch list
./codex-switch current
./codex-switch status
./codex-switch use main
./codex-switch use main --no-restart
./codex-switch remove work
```

## 保存内容

- `~/.codex/auth.json`
- `~/Library/Application Support/Codex/Cookies`
- `~/Library/Application Support/Codex/Cookies-journal`

账号快照保存在 `~/.codex-switch/accounts/<name>/`，切换前会自动备份当前状态到 `~/.codex-switch/backups/`。

`use` 会先更新当前账号快照，再退出并重新打开 Codex；这是为了保存最新轮换后的 refresh token。

如果某个账号已经报 `refresh token was revoked` 或 `token exchange failed`，需要手动重新登录该账号后再执行一次 `./codex-switch save <name>`。

`status` 会提示 `Cookies` 是否比 `auth.json` 新；如果是，说明你只换了 App 网页登录态，CLI 认证文件还没更新。

新增账号可以直接用 `add`：它会备份并移走当前登录态、重开 Codex；你完成网页登录后回到终端按 Enter，脚本会自动保存。
