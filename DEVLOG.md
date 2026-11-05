# DEVLOG · erratlas

> 从 `优化/errs3.cjs` 脱胎而来。原始需求：把自己 agent 日志里的工具报错解剖清楚，做成能公布的东西。

## 已定决策

| 日期 | 决策 | 理由 |
|---|---|---|
| 2026-11-06 | 定位 = 跨 agent 错误解剖器，不做会话打分 | `inspecto` 已占打分/回归赛道（npm 2600+ 下载，12 指标含 M9 tool error rate、M1 reads-before-edit）；重复没意义 |
| 2026-11-06 | 差异化三点：静默失败 / 因果归因 / 跨 agent | inspecto 的 M9 只数 is_error，看不见「成功但 exit 1」；也不跨 agent |
| 2026-11-06 | 形态 = 零依赖 ESM npm 包，`erratlas` | 包名当时未被占用；单文件级安装体验，视频里好演示 |
| 2026-11-06 | 适配器 = dsh 内置 + 通用 JSONL 映射 | 本机没有 `~/.claude`，硬编码 Claude Code 适配器无法验证；映射文件让用户自己改字段，不写代码 |
| 2026-11-06 | 判定口径 = harness 的 isError 字段 | 旧版 `errs2.cjs` 用正则，把正常输出里的 Traceback/exit code 算成报错，2667 vs 真实 1236，误报一倍 |

## 调研记录（开工前联网搜的现成方案）

- **inspecto**（MIT，npm 2600+）— Claude Code 会话质量分析，12 指标 + 打分 + 基线回归 + watch + SQLite 缓存 + CI 退出码。相关性最高，**它覆盖了我们原本想做的「打分」和「reads-before-edit」**。
- **clawmetry / codex-stats / contextrot / warden-agent** — 偏 token 成本、上下文腐化、运行时监控，不做失败归因。
- **ccusage / claude-usage** — 纯花费统计。
- 结论：失败归因（31 类因果 + 静默失败 + 归属）基本是空位；打分赛道不要碰。

## 关键事实

- 本机 Node v24.19.0，npm 11.17.0；**PATH 里没有 node**，脚本里要写 `/c/Program Files/nodejs/node.exe`。
- `node --test test/` 在 Node 24 上会当成模块路径报错，要写 `node --test "test/**/*.test.mjs"`。
- npm 未登录（ENEEDAUTH），发布前需要 `npm login`。
- gh 已登录 `NullTech-EndBlue`，但不在 PATH，实际路径 `C:/Users/EndBlue/.dsh/bin/gh.exe`。

## 实测数据（2026-11-06，DSH 本机日志）

- 431 个会话文件，35,094 次工具调用，1,237 次报错（3.5%）
- 归属：编辑版本摩擦 24% / 代码写错 21% / 编辑没对准 11% / 参数写错 8% / 超时 8% / 工具边界 9% / 路径 6% / 其它 13%
- 静默失败 1,731 / 33,800（5.1%），其中 pwsh 的 `[exit code: 1]` 占大头
- 全量扫描 7.2s，增量 0.1s

## 待办

- [x] Claude Code preset 验完（2026-11-06，用公开 transcript）→ 发现并修掉一个真 bug
- [x] Codex preset 验完（2026-11-06，用公开 rollout）→ 适配器为此改了多 spec 支持
- [ ] `npm publish`（需要本地登录）
- [ ] 配套视频（另一个会话在做）
## 2026-11-06 · Claude Code preset 用公开样例验证

本机没有 `~/.claude`，改从 GitHub 找公开 transcript（不装任何东西）：

| 仓库 | 文件 | 贡献了什么 |
|---|---|---|
| agentlogs/agentlogs | fixtures/claudecode/crud.jsonl | 真实会话主结构 + 噪声记录类型 |
| dosu-ai/decant | fixtures/claude/sample.jsonl | 顶层 is_error 布尔字段 |
| FankChen/tracecrate | examples/claude.jsonl | 精简版：type/timestamp/message |
| yfge/TalkReplay | fixtures/claude/tool_use_result.jsonl | **Bash 结果的关键差异** |

**验证结论：preset 大体对，但有一处会静默出错。** Claude Code 的 Bash 工具结果里，
is_error 不在 block 顶层，而是嵌在 content 对象里（stdout / stderr / is_error 三个键）。
按原 preset 解析，所有 Bash 失败都会被当成成功——正是本工具专门在抓的那种「静默失败」。

修法：

1. error 支持路径数组：先看 is_error，再看 content.is_error，取第一个布尔值；
2. asText 认识 stdout/stderr 结构，折成文本（否则静默失败检测没东西可查）；
3. 补 4 条 Claude Code 措辞规则：String to replace not found in file、Found N matches of the string to replace、File has not been read yet、File has been modified since read。

fixture 用真实形状重写（结构照真实案例，内容自造，不含任何第三方数据），测试 15 → 16 全过。
## 2026-11-06 · Codex preset 用公开样例验证

老大登不上 Codex，同样走公开素材。四个仓库的 rollout：`agentlogs/agentlogs`、
`FankChen/tracecrate`、`dosu-ai/decant`、`wibus-wee/huihua`。

**真实结构（和 Claude Code 完全不同）**

- 外层：`{timestamp, type: session_meta | turn_context | response_item | event_msg, payload}`
- 调用：`payload.type = function_call`（`name` / `arguments` 是 JSON 字符串 / `call_id`）
- 还有第二套：`payload.type = custom_tool_call`（`name` / `input` / `call_id`），输出是 `custom_tool_call_output`
- 结果文本三种形态：
  - 字符串：`Chunk ID..\nProcess exited with code 0\nOutput:\n...`
  - 对象：`{stdout, exit_code}`
  - **JSON 字符串套 JSON**：`{"output": "...", "metadata": {"exit_code": 0}}`

**没有通用的错误字段。** 只有个别案例带 `payload.is_error` 或 `output.error`；
shell 调用失败全靠文本里的 `Process exited with code N`。所以 codex 的失败率只能是下限。

适配器为此改了三处：

1. 一个 mapping 现在可以有多条 call / result spec（codex 有两套工具调用；DSH 和 Claude Code 各一套）；
2. `asText` 认识 `{stdout,stderr,exit_code}` 与 `metadata.exit_code`，非 0 时补一行 `[exit code: N]`；
3. 以 `{` 或 `[` 开头的字符串会先尝试 JSON.parse 再取文本（codex 的 output 是 JSON 字符串）。

**踩的坑（记下来免得再犯）**：preset 里写 errorPattern 时，JS 字符串 `"\[exit code"` 里的 `\[`
会退化成 `[`，整个正则变成字符类，于是**所有**输出都判成失败。测试立刻抓到——写正则一律用 `\\[`。

fixture 用真实形状重写（内容自造），测试 16 → 17 全过。
