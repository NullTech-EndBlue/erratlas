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

- [ ] Claude Code / Codex preset 用真实日志验一遍（本机没有 `~/.claude`、`~/.codex`）
- [ ] `npm publish`（需要本地登录）
- [ ] 配套视频（另一个会话在做）
