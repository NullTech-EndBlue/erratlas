# erratlas

Anatomy of AI agent tool failures. Not a score — a diagnosis.

Most agent observability tools tell you what you spent, or grade a session 0–100.
erratlas asks a narrower question: **when a tool call failed, whose fault was it —
the model, the environment, or the harness itself?**

It reads the session logs your agent already writes (DeepSeek Harness built in; Claude Code,
Codex and anything else through a mapping file), and turns tens of thousands of tool calls
into a ranked list of causes you can actually act on.

## What it does

- Every failed tool call is classified into one of 31 causes, then rolled up into 11 ownership groups.
- Signatures are normalized (paths, ids, numbers stripped), so 200 identical failures collapse into one row.
- **Silent failures**: calls the harness marked successful whose output says `[exit code: 1]`,
  a traceback, or an HTTP 404 page. These are invisible to error-rate counters.
- Attribution by tool, by model, by session, by day.
- Incremental cache: the first scan parses everything, every later run takes ~0.1s.

## Install

```bash
npx erratlas --demo          # synthetic data, zero setup
npm i -g erratlas            # or install globally
```

Requires Node 22.15+ (uses `node:zlib` zstd support). Zero runtime dependencies.

## Quickstart

```bash
erratlas --demo                                  # see what the output looks like
erratlas --list --root ~/.dsh/sessions           # how many log files are there
erratlas --root ~/.dsh/sessions --day --silent   # the real report
erratlas --tool edit --detail --samples 3        # drill into one tool
erratlas --model glm --since 2026-11-01          # one model, one week
erratlas --md report.md                          # markdown for a PR or a blog post
erratlas --json failures.json                    # raw records for your own analysis
erratlas --fail-over 5                           # exit 1 if the failure rate exceeds 5%
```

## The finding that made me write this

On ~35,000 real tool calls from my own agent logs:

| ownership | share |
|---|---:|
| editor version friction (must read before edit) | 24% |
| my code was wrong (syntax / runtime) | 21% |
| edit target did not match | 11% |
| bad tool arguments | 8% |
| timeout | 8% |
| tool capability edge (PDFs, binary files, ...) | 9% |
| wrong path or range | 6% |
| interrupted / policy / environment | 13% |

**89% of failures had nothing to do with the model being smart or dumb.**
They were process friction and plain fumbling. And 5% of *successful* calls were
silently broken — the tool reported success while the command inside it exited 1.

Your numbers will differ. That is the point: run it and find out.

## How a failure is decided

Ground truth is the harness's own error flag on the tool result — not a regex over
output text. (An early version of this tool guessed from text and over-counted
failures by 2x, because grep results and build logs contain the word `Traceback`.)

Then a wrapper is stripped (`Error: code run failed (exception): ...` → the inner message),
and the first line is matched against an ordered rule set. Comments in
`src/classify.mjs` list every rule; adding one is a single line.

Silent failures are a separate axis: results with **no** error flag whose text still
contains an exit marker, a traceback, a stderr block, or a 4xx/5xx status.

## Any agent, not just one

`--adapter dsh` is built in (DeepSeek Harness session logs). For anything else, pass a
mapping file that says where the ids, tool names, arguments and result text live:

```bash
erratlas --root ~/.claude/projects --adapter generic --mapping presets/claude-code.json
```

```json
{
  "name": "claude-code",
  "root": "~/.claude/projects",
  "include": ["**/*.jsonl"],
  "time": "timestamp",
  "records": [
    { "kind": "call", "where": { "type": "assistant" }, "each": "message.content[]",
      "eachWhere": { "type": "tool_use" }, "id": "id", "tool": "name",
      "args": "input", "model": "message.model" },
    { "kind": "result", "where": { "type": "user" }, "each": "message.content[]",
      "eachWhere": { "type": "tool_result" }, "id": "tool_use_id",
      "error": "is_error", "text": "content" }
  ]
}
```

If your format has no error flag at all, use `errorPattern` (a regex over the result
text) and treat the numbers as a lower bound. `presets/` ships examples for Claude Code
and Codex CLI.

## Ownership groups

| group | meaning |
|---|---|
| `1-tool-friction` | the editor demanded a read / the file changed under you |
| `2-bad-code` | syntax errors, runtime errors, shell exit codes |
| `3-fumbled-edit` | `old_string` not found, ambiguous, or a no-op edit |
| `4-bad-arguments` | missing required fields, unknown tools |
| `5-wrong-path` | path does not exist, offset out of range |
| `6-timeout` | hit the execution deadline |
| `7-capability-edge` | the tool genuinely cannot do this (PDFs, binaries, cross-origin) |
| `8-environment` | filesystem / network / runtime faults |
| `9-interrupted` | cancelled by a human or an abort |
| `10-policy` | plan mode, permissions, config gates |
| `11-residual` | anything the rules did not cover |

## Options

```
--root <dir>        scan this directory (default: ~/.dsh/sessions, else ~/.claude/projects)
--adapter <name>    dsh | generic
--mapping <file>    JSON mapping for the generic adapter
--list              just show what would be scanned
--refresh           re-parse every file
--no-cache          do not touch the cache
--cache <file>      cache path (default: ~/.erratlas/cache.json)
--tool --model --cat --grep --since --until     filters
--top <n>           rows per table
--day --week        trends
--silent            calls that claim success but failed
--sessions          per-session ranking
--detail --samples  raw samples per signature
--json [file] --md [file]                       machine output
--fail-over <pct>   exit 1 above this failure rate
--zh                Chinese labels
```

## Honest limits

- The `claude-code` preset is **verified against public transcripts** (agentlogs/agentlogs,
  dosu-ai/decant, FankChen/tracecrate, yfge/TalkReplay): `tool_use` / `tool_result` blocks,
  content as a string or a block array, and `is_error` either on the block or nested inside
  a `{stdout, stderr, is_error}` content object for Bash. That nesting is what silently breaks
  naive parsers — if every Bash call looks successful in your output, this is why.
- The `codex` preset is **verified against public rollouts** (agentlogs/agentlogs,
  FankChen/tracecrate, dosu-ai/decant, wibus-wee/huihua): `response_item` records with a
  `payload`, two call families (`function_call` / `custom_tool_call`), and outputs that are
  strings, `{stdout, exit_code}` objects, or JSON-in-a-string with `metadata.exit_code`.
  Codex has **no error flag for shell calls** — failures are inferred from
  `Process exited with code N` and friends, so treat the count as a lower bound.
- Cross-agent wording is normalized (`String to replace not found in file` and
  `old_string was not found` map to the same cause), but the rule set is finite.
- Classification is a rule set, not a model. Unknown failures land in `Z-other` on
  purpose — check that bucket before trusting the totals.
- Silent-failure detection is heuristic by nature; it tells you where to look, not
  what the exit code meant.
- Nothing leaves your machine. No network calls, no telemetry.

If you want session grading, quality scores and regression detection over time,
[inspecto](https://www.npmjs.com/package/inspecto) does that well. erratlas is the
complement: it explains *why* calls failed instead of scoring how the session went.

## Authors

Written by two contributors, one of them not human:

- **NullTech-EndBlue** — direction, decisions, the logs this was built against, packaging and publishing.
- **DeepSeek Harness (AI agent)** — implementation, the 31 classification rules, both preset verifications, the test suite.

The first real finding was about its own author: on 35,000 real tool calls, 89% of failures
had nothing to do with the model being smart or dumb — they were process friction and plain
fumbling. The tool exists because that number was surprising.

## License

MIT

---

## 中文简介

`erratlas` 把你 AI agent 的会话日志翻成一份「错题本」：每一次工具调用失败都被归到 31 个原因之一，
再汇总成 11 个责任归属（不是模型不行，是流程摩擦/手滑/工具边界）。

它和 `inspecto` 这类「给会话打分」的工具互补：那个回答「这次干得好不好」，
这个回答「为什么错、错在谁身上」。

```bash
npx erratlas --demo                               # 先看效果，不需要任何日志
erratlas --root ~/.dsh/sessions --day --silent    # 扫自己的日志
erratlas --md report.md                           # 出一份 markdown 报告
```

最值得看的一栏是 `--silent`：工具标记为成功、但输出里带着 `[exit code: 1]` 或 traceback 的调用。
这类失败在普通的错误率统计里完全看不见。