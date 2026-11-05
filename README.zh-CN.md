# erratlas

> 把你 AI agent 的会话日志翻成一本**错题本**。
> English: [README.md](README.md)

它不给你打分，它回答一个问题：**这次工具调用失败，错在谁身上？**

同一个问题，打分工具（比如 [inspecto](https://www.npmjs.com/package/inspecto)）的答案是一个 0-100 的分数。
erratlas 的答案是一条条原因：是你代码写错了、是编辑前忘了读文件、是路径猜错了、是工具本来就做不到，
还是——**工具明明失败了，却跟你报告成功**。

零依赖，Node ≥ 22.15，数据不出本机。

## 30 秒看效果

```bash
npx erratlas --demo        # 合成数据，不需要任何日志
npx erratlas --demo --zh   # 中文标签
```

真实输出（`--demo --zh`）：

```
root=(demo)  files=0  undecodable=0  cache: reused=0 scanned=0 in 0ms
window=2026-11-06..2026-11-06
tool results=12  isError=true 8 (66.7%)

-- by tool --
    4 /      4 100.0%  run_code
    3 /      3 100.0%  edit
    1 /      1 100.0%  web_fetch

-- by model --
    6 /      8 75.0%  demo-model-a
    2 /      4 50.0%  demo-model-b

-- whose problem --
    3  37.5%  代码写错
    2  25.0%  编辑版本摩擦
    1  12.5%  编辑没对准(手滑)
    1  12.5%  超时(太重)
    1  12.5%  工具能力边界

-- by cause --
    3  D-ts-syntax           run_code:3
    1  A-edit-need-read      edit:1
    1  A-edit-stale          edit:1
    1  B-edit-no-match       edit:1
    1  E-timeout             run_code:1
    1  G-unsupported-content web_fetch:1

-- top signatures --
    2  D-ts-syntax | Expected a semicolon
    1  A-edit-need-read | cannot modify "src/a.ts": file has not been read - read the file, then retry
    1  A-edit-stale | cannot edit "src/b.ts": file changed since it was read - re-read the file, then retry
    1  D-ts-syntax | Expected ',', got 'ident'
    1  B-edit-no-match | old_string was not found in "src/c.ts"
    1  E-timeout | execution deadline reached after Ns
    1  G-unsupported-content | unsupported content type "application/pdf"
```

## 装好跑自己的日志

```bash
npm i -g erratlas

erratlas --list --root ~/.dsh/sessions        # 先看扫到多少个文件
erratlas --root ~/.dsh/sessions --zh          # 主报告
erratlas --root ~/.dsh/sessions --day --silent --sessions
```

参数全部可以叠加。第一次全量扫描解析所有文件（本机 431 个文件约 7 秒），
之后只重扫改动过的文件（约 0.1 秒）；缓存放在 `~/.erratlas/cache.json`。

## 它到底怎么判定「失败」

**以 harness 自己写的错误标记为准**（工具结果上的 isError 字段），不靠正则猜输出文本。

这一条是踩出来的。最早那版用正则匹配 `Traceback`、`ENOENT`、`exit code: 1`，
结果把 grep 的正常命中、构建日志里滚出来的堆栈全算成报错——**报出 2667 次，真实只有 1236 次，虚报一倍**。
统计工具自己虚报一倍，比没有工具更危险。

判定之后再分两步：

1. 剥掉 harness 的包装（`Error: code run failed (exception): ...` → 只留里面的真话）；
2. 拿**第一行**去过规则表，命中即归类。规则表在 `src/classify.mjs`，加一条就是加一行正则。

### 静默失败是第二条轴

除了「被标记为失败」的调用，还有一类：**没有错误标记，但输出里写着失败**。

```
$ pwsh -c "..."
[exit code: 1]          ← 工具层认为这次调用是成功的
```

本机 35,000 次调用里有 **1,731 条（5.1%）** 是这种。它们在普通错误率统计里完全隐形，
而 agent 只能靠自己读输出才能发现。`--silent` 就是专门列这个的。

## 我从 35,000 次真实调用里看到的

| 归属 | 占比 |
|---|---:|
| 编辑版本摩擦（必须先读再改、读后文件被改了） | 24% |
| 代码写错（语法 / 运行时） | 21% |
| 编辑没对准（old_string 找不到 / 无变化 / 多处匹配） | 11% |
| 工具能力边界（PDF、二进制、跨域） | 9% |
| 超时 | 8% |
| 参数写错 | 8% |
| 路径 / 范围猜错 | 6% |
| 被打断、策略限制、系统故障、其它 | 13% |

**89% 的失败跟模型聪不聪明没关系**，是流程摩擦和手滑。
这个结论跟「AI 很笨」和「AI 很强」两种叙事都不搭，所以值得说出来。

## 支持哪些日志

### DeepSeek Harness（内置）

```bash
erratlas --root ~/.dsh/sessions
```

### Claude Code

```bash
erratlas --root ~/.claude/projects --adapter generic --mapping presets/claude-code.json
```

已用公开 transcript 验证过（agentlogs/agentlogs、dosu-ai/decant、FankChen/tracecrate、yfge/TalkReplay）。
**踩到的坑**：Bash 的 `is_error` 不在工具结果那一层，而是嵌在 `content` 对象里
（`{stdout, stderr, is_error}`）。只看顶层的解析器会把**所有 Bash 失败当成成功**。

### Codex CLI

```bash
erratlas --root ~/.codex/sessions --adapter generic --mapping presets/codex.json
```

已用公开 rollout 验证（agentlogs/agentlogs、FankChen/tracecrate、dosu-ai/decant、wibus-wee/huihua）。
Codex 对 shell 调用**没有通用错误字段**，失败只能从 `Process exited with code N` 这类文本推断，
所以 codex 那条路的失败率只是**下限**。

### 其它任何 agent

写一个映射文件告诉它字段在哪，不用改代码：

```json
{
  "name": "my-agent",
  "root": "~/.myagent/logs",
  "include": ["**/*.jsonl"],
  "time": "timestamp",
  "records": [
    { "kind": "call", "where": { "type": "tool_call" },
      "id": "call_id", "tool": "name", "args": "arguments" },
    { "kind": "result", "where": { "type": "tool_result" },
      "id": "call_id", "error": "is_error", "text": "output" }
  ]
}
```

字段说明：

| 字段 | 作用 |
|---|---|
| `where` | 这一行记录要满足什么条件（按路径取值后精确比对） |
| `each` | 真正的内容在哪个子路径；给数组时逐个处理 |
| `eachWhere` | 数组里每个元素的额外条件 |
| `id` | 调用与结果的对应键 |
| `tool` / `args` / `model` | 工具名 / 参数 / 模型 |
| `error` | 错误标记的路径，**可以是数组**（如 `["is_error", "content.is_error"]`，取第一个布尔值） |
| `errorPattern` | 完全没有错误字段时，用正则从结果文本推断失败 |
| `text` | 结果文本的路径；字符串、块数组、`{stdout,stderr,exit_code}`、JSON 字符串都能吃 |

## 常用命令

```
--root <dir>        扫这个目录（默认 ~/.dsh/sessions，其次 ~/.claude/projects）
--adapter <name>    dsh | generic
--mapping <file>    generic 适配器的映射文件
--list              只看会扫到哪些文件
--refresh           忽略缓存全量重扫
--no-cache          不读也不写缓存
--tool / --model / --cat / --grep / --since / --until   过滤
--top <n>           每张表几行
--day / --week      趋势
--silent            列出「自称成功其实失败」的调用
--sessions          按会话排行
--detail --samples  每个签名给原文样本
--json [file]       原始记录（给下游分析）
--md [file]         直接出一份 markdown 报告
--fail-over <pct>   失败率超过这个百分比就退出码 1（接 CI）
--zh                中文标签
--demo              合成数据试跑
```

## 11 个归属组

| 组 | 意思 |
|---|---|
| `1-tool-friction` | 编辑器要求先读再改 / 读完之后文件被改了 |
| `2-bad-code` | 语法错、运行时错、shell 退出码 |
| `3-fumbled-edit` | `old_string` 找不到、匹配多处、改成一样的内容 |
| `4-bad-arguments` | 缺必填参数、工具名写错 |
| `5-wrong-path` | 路径不存在、offset 越界 |
| `6-timeout` | 撞上执行时限 |
| `7-capability-edge` | 工具本身就做不到（PDF、二进制、跨域） |
| `8-environment` | 文件系统 / 网络 / 运行时故障 |
| `9-interrupted` | 被人取消、被中止 |
| `10-policy` | plan 模式、权限、配置闸门 |
| `11-residual` | 规则没覆盖到的——先看这一桶，再信总数 |

## 常见问题

**`--list` 显示 0 个文件？**
路径或 `include` 不对。通用的 JSONL 撞不上就往映射文件里改，不用改代码。

**所有 Bash 调用都显示成功？**
十有八九是错误标记嵌在结果对象里没读到——见上面 Claude Code 那一节。`--detail` 打一条原文就能确认。

**失败率为什么是下限？**
有些 harness（比如 Codex）根本不写错误字段，只能靠文本推。没写出来的失败就是数不到。

**数据会上传到哪？**
不会。没有任何网络请求、没有遥测，全在本机算。

**删掉缓存有什么后果？**
下次跑重新全量解析一遍，慢几秒，没别的。缓存在 `~/.erratlas/cache.json`。

## 限制（说实话）

- 分类是规则表，不是模型。没见过的失败会落进 `Z-other`，这是故意的——
  先用 `--cat Z` 看一眼那一桶，再决定信不信总数。
- 静默失败检测是启发式：它告诉你该往哪看，不负责解释退出码的含义。
- 两个 preset 都拿公开日志验过，但你的 harness 版本可能又变了字段。
  验证成本很低：`--list` 加 `--detail` 各跑一次就知道。

## 作者

- **NullTech-EndBlue** —— 方向、决策、被分析的那批日志、打包与发布。
- **大肥鱼小蓝**（AI agent）—— 实现、31 条分类规则、两个 preset 的验证、测试。

有意思的是，这个工具第一次算出结论，是关于它自己作者的：3.5 万次调用里，
89% 的失败不是因为聪明与否，而是流程摩擦和手滑。工具存在就是因为这个数字反直觉。

## 许可

MIT
