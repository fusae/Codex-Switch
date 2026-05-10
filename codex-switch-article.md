# Codex-Switch：给多账号 Codex 用户的一键切换工具

如果你只有一个 Codex 账号，登录一次之后基本不会再关心认证文件。但如果你同时有个人账号、工作账号、测试账号，切换流程就会变得很烦：退出登录、重新走 ChatGPT 网页授权、等 Codex 写回本地登录态，有时还会碰到手机号验证或 token 刷新失败。

Codex-Switch 解决的是这个具体问题：把不同 Codex 账号的本地登录态保存成快照，需要切换时直接恢复对应快照，并重启 Codex。

## 痛点

Codex 当前的账号切换不是为多账号高频使用设计的。正常流程是先 logout，再通过网页重新 login。对偶尔切换的人可以接受，但对重度用户很浪费时间。

更麻烦的是，Codex App 的网页登录态和 CLI/API 使用的认证文件不是完全同步的。你可能已经在 App 里看起来切到了新账号，但 `~/.codex/auth.json` 仍然是旧账号。此时直接保存快照，会把旧账号 token 存成新账号名字。

所以这个工具不只是复制文件，还需要提供 `status` 这类检查命令，避免误保存。

## 实现思路

Codex-Switch 的核心逻辑很简单：保存和恢复本地认证状态。

当前实现主要处理这些文件：

- `~/.codex/auth.json`
- `~/Library/Application Support/Codex/Cookies`
- `~/Library/Application Support/Codex/Cookies-journal`

`auth.json` 是关键文件，里面包含 `access_token`、`refresh_token`、`account_id` 等信息。Codex Cookies 则影响 App 内网页登录态。只切其中一个，容易出现 App 看起来是一个账号、CLI 实际还是另一个账号的错位状态。

账号快照默认保存在：

```bash
~/.codex-switch/accounts/<name>/
```

切换前会把当前状态备份到：

```bash
~/.codex-switch/backups/
```

## Refresh Token 轮换的坑

这个工具最容易踩的坑是 refresh token rotation。

Codex 使用的 refresh token 不是永远不变的。服务端可能在刷新 access token 时签发新的 refresh token，并让旧 token 失效。如果你保存的是旧快照，过一段时间再切回去，就可能看到：

```text
Your access token could not be refreshed because your refresh token was revoked.
```

或者：

```text
token exchange failed
```

所以 `use` 命令不能只是覆盖文件。更稳妥的做法是：切换前先把当前账号的最新 `auth.json` 和 Cookies 写回当前快照，再恢复目标账号，并重启 Codex。

Codex-Switch 已经按这个逻辑处理。

## 命令说明

新增账号：

```bash
./codex-switch add work
```

它会备份并移走当前登录态，重开 Codex；你在 Codex 里登录新账号后，回到终端按 Enter，脚本会自动保存。

保存当前账号：

```bash
./codex-switch save main
```

如果脚本发现当前 `account_id` 已经被保存成另一个账号名，会拒绝保存，避免误把同一个账号存成多个名字。确实要覆盖时再用：

```bash
./codex-switch save main --force
```

切换账号：

```bash
./codex-switch use main
./codex-switch use work
```

`use` 会先更新当前 active 账号快照，再恢复目标账号，并退出重开 Codex。

查看已保存账号：

```bash
./codex-switch list
```

查看当前 `auth.json` 里的账号：

```bash
./codex-switch current
```

检查当前状态：

```bash
./codex-switch status
```

`status` 会显示 `auth.json` 的 `account_id`、文件更新时间、Codex Cookies 更新时间。如果 Cookies 比 `auth.json` 新，通常说明你只换了 App 网页登录态，CLI 登录态还没同步。

删除账号快照：

```bash
./codex-switch remove work
```

也可以用别名：

```bash
./codex-switch rm work
./codex-switch delete work
```

## 适用边界

Codex-Switch 适合在同一台机器上管理多个 Codex 账号，尤其是个人账号、工作账号、测试账号之间来回切换。

它不适合把账号快照拿到多台机器之间同步。refresh token 会轮换，多设备共享同一份快照很容易互相污染，最后导致某个账号必须重新登录。

它也不能绕过 OpenAI 服务端的风控和验证。如果某个账号在 Codex 登录时被要求手机号验证，而当前手机号地区不支持，这不是本地文件切换能解决的问题。

## 安全提醒

`auth.json` 和 Cookies 都是敏感文件。它们不应该提交到 Git，也不应该发给别人。

建议保证快照目录只允许当前用户访问：

```bash
chmod -R go-rwx ~/.codex-switch
```

如果某个账号不再使用，直接删除快照：

```bash
./codex-switch remove account-name
```

Codex-Switch 的价值不在于复杂，而在于把一套容易出错的手动流程固定下来：保存当前状态、恢复目标状态、检查账号标识、处理 token 轮换。对多账号 Codex 用户来说，这已经足够把切换成本降到一条命令。
