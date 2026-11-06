#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanTree } from '../src/scan.mjs';
import { makeAdapter } from '../src/adapters/generic.mjs';
import * as dsh from '../src/adapters/dsh.mjs';
import { defaultCachePath } from '../src/cache.mjs';
import { analyze, toJson, toMarkdown, renderText, renderDayText, renderSilentText, renderSessionsText } from '../src/report.mjs';
import { classify, signature } from '../src/classify.mjs';
import { redactRecords } from '../src/redact.mjs';

const HELP = [
  'erratlas - anatomy of AI agent tool failures',
  '',
  'Usage',
  '  erratlas [options]',
  '',
  'Where the logs are',
  '  --root <dir>        scan this directory (default: ~/.dsh/sessions, else ~/.claude/projects)',
  '  --adapter <name>    dsh | generic   (default: dsh)',
  '  --mapping <file>    JSON mapping for the generic adapter (see presets/)',
  '  --list              only list how many files were found and where',
  '',
  'Cache',
  '  --refresh           re-parse every file',
  '  --no-cache          do not read or write the cache',
  '  --cache <file>      cache location (default: ~/.erratlas/cache.json)',
  '',
  'Filtering',
  '  --tool <name>       only this tool',
  '  --model <substr>    only models matching this substring',
  '  --cat <prefix>      only causes with this prefix, e.g. A, D-ts',
  '  --grep <regex>      regex over failure text',
  '  --since <date>      YYYY-MM-DD inclusive (local time)',
  '  --until <date>      YYYY-MM-DD inclusive',
  '',
  'Report',
  '  --top <n>           rows per table (default 20)',
  '  --day               failures per day',
  '  --week              failures per week',
  '  --silent            shows calls that claim success but failed',
  '  --sessions          per-session ranking',
  '  --detail            one raw sample per signature',
  '  --samples <n>       samples per signature with --detail (default 1)',
  '  --zh                Chinese labels, --tz <minutes> timezone offset (default: local)',
  '  --redact            replace paths, emails, urls, ips, tokens, session ids and project names',
  '',
  'Machine output',
  '  --json [file]       JSON records (stdout when no file)',
  '  --md [file]         markdown report (stdout when no file)',
  '  --fail-over <pct>   exit 1 when the failure rate exceeds this percentage',
  '  --demo              run on synthetic data, no logs needed',
  '  --version, --help',
].join('\n');

function parseArgs(argv) {
  const o = { roots: [], top: 20, samples: 1 };
  const take = (i) => argv[i + 1];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--root': o.roots.push(take(i)); i++; break;
      case '--adapter': o.adapter = take(i); i++; break;
      case '--mapping': o.mapping = take(i); i++; break;
      case '--cache': o.cache = take(i); i++; break;
      case '--refresh': o.refresh = true; break;
      case '--no-cache': o.noCache = true; break;
      case '--list': o.list = true; break;
      case '--tool': o.tool = take(i); i++; break;
      case '--model': o.model = take(i); i++; break;
      case '--cat': o.cat = take(i); i++; break;
      case '--grep': o.grep = take(i); i++; break;
      case '--since': o.since = take(i); i++; break;
      case '--until': o.until = take(i); i++; break;
      case '--top': o.top = parseInt(take(i), 10) || 20; i++; break;
      case '--samples': o.samples = parseInt(take(i), 10) || 1; i++; break;
      case '--day': o.day = true; break;
      case '--week': o.week = true; break;
      case '--trend': o.week = true; o.day = true; break;
      case '--silent': o.silent = true; break;
      case '--sessions': o.sessions = true; break;
      case '--detail': o.detail = true; break;
      case '--zh': o.zh = true; break;
      case '--redact': o.redact = true; break;
      case '--tz': o.tz = parseInt(take(i), 10); i++; break;
      case '--json': o.json = (take(i) && !take(i).startsWith('--')) ? take(i) : true; if (o.json !== true) i++; break;
      case '--md': o.md = (take(i) && !take(i).startsWith('--')) ? take(i) : true; if (o.md !== true) i++; break;
      case '--fail-over': o.failOver = parseFloat(take(i)); i++; break;
      case '--demo': o.demo = true; break;
      case '--version': o.version = true; break;
      case '--help': case '-h': o.help = true; break;
      default:
        if (a.startsWith('-')) { console.error('unknown option: ' + a); process.exit(2); }
        o.roots.push(a);
    }
  }
  return o;
}

function defaultRoot() {
  const dshPath = path.join(os.homedir(), '.dsh', 'sessions');
  if (fs.existsSync(dshPath)) return dshPath;
  const claudePath = path.join(os.homedir(), '.claude', 'projects');
  if (fs.existsSync(claudePath)) return claudePath;
  return dshPath;
}

function demoRecords() {
  const now = Date.now();
  const mk = (i, tool, ie, tx, sm) => ({
    t: now - i * 60000, tool, model: i % 3 ? 'demo-model-a' : 'demo-model-b', sid: 'demo-session',
    proj: 'demo', ie, tx, tl: (tx || '').length, sm,
  });
  return [
    mk(1, 'edit', 1, 'cannot modify "src/a.ts": file has not been read - read the file, then retry'),
    mk(2, 'edit', 1, 'cannot edit "src/b.ts": file changed since it was read - re-read the file, then retry'),
    mk(3, 'run_code', 1, 'Error: code run failed (exception): Expected a semicolon'),
    mk(4, 'run_code', 1, 'Error: code run failed (exception): Expected a semicolon'),
    mk(5, 'run_code', 1, 'Error: code run failed (exception): Expected \',\', got \'ident\''),
    mk(6, 'edit', 1, 'old_string was not found in "src/c.ts"'),
    mk(7, 'run_code', 1, 'execution deadline reached after 300s'),
    mk(8, 'bash', 0, 'build ok'), mk(9, 'bash', 0, 'some output\n[exit code: 1]', ['exit-marker']),
    mk(10, 'read', 0, 'file body'), mk(11, 'web_fetch', 1, 'unsupported content type "application/pdf"'),
    mk(12, 'bash', 0, 'Traceback (most recent call last): boom', ['traceback']),
  ];
}

function parseDay(s, endOfDay, offMin) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) - offMin * 60000 + (endOfDay ? 86399999 : 0);
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || process.argv.length <= 2) { console.log(HELP); return 0; }
  if (o.version) {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    console.log(pkg.version);
    return 0;
  }
  o.tzOffsetMin = (typeof o.tz === 'number') ? o.tz : -new Date().getTimezoneOffset();

  let adapter = dsh;
  if (o.adapter === 'generic' || o.mapping) {
    if (!o.mapping) { console.error('--adapter generic needs --mapping <file>'); return 2; }
    const mapping = JSON.parse(fs.readFileSync(o.mapping, 'utf8'));
    adapter = makeAdapter(mapping);
    if (!o.roots.length && mapping.root) o.roots.push(mapping.root);
  }

  let recs;
  let stats = { root: '(demo)', files: 0, reused: 0, scanned: 0, bad: 0, ms: 0 };
  if (o.demo) {
    recs = demoRecords();
  } else {
    const roots = o.roots.length ? o.roots : [defaultRoot()];
    recs = [];
    for (const r of roots) {
      const res = scanTree({ root: r, adapter, cachePath: o.cache || defaultCachePath(), refresh: o.refresh, noCache: o.noCache });
      recs = recs.concat(res.recs);
      stats = res.stats;
      if (o.list) console.log(res.stats.root + '  files=' + res.stats.files + '  records=' + res.recs.length);
    }
    if (o.list) return 0;
  }

  if (!recs.length) { console.error('no tool results found. try --list, or --root <dir>'); return 2; }

  // filters
  const since = parseDay(o.since, false, o.tzOffsetMin);
  const until = parseDay(o.until, true, o.tzOffsetMin);
  if (since !== null) recs = recs.filter((r) => r.t >= since);
  if (until !== null) recs = recs.filter((r) => r.t <= until);
  if (o.tool) recs = recs.filter((r) => r.tool === o.tool);
  if (o.model) recs = recs.filter((r) => String(r.model).includes(o.model));
  if (o.cat) recs = recs.filter((r) => (r.ie ? classify(r).startsWith(o.cat) : false));
  if (o.grep) {
    const re = new RegExp(o.grep, 'i');
    recs = recs.filter((r) => !r.ie || re.test(r.tx || ''));
  }

  if (o.redact) {
    recs = redactRecords(recs);
    stats = Object.assign({}, stats, { root: '<root>' });
  }

  const a = analyze(recs, { top: o.top, tzOffsetMin: o.tzOffsetMin });

  if (o.json) {
    const js = JSON.stringify(toJson(a), null, 1);
    if (o.json === true) console.log(js);
    else { fs.writeFileSync(o.json, js); console.log('wrote ' + a.errors + ' failure records -> ' + o.json); }
    return 0;
  }
  if (o.md) {
    const md = toMarkdown(a, stats);
    if (o.md === true) console.log(md);
    else { fs.writeFileSync(o.md, md); console.log('wrote markdown -> ' + o.md); }
    return 0;
  }

  const parts = [renderText(a, stats, o.zh)];
  if (o.day) parts.push(renderDayText(a, 'day', o.tzOffsetMin));
  if (o.week) parts.push(renderDayText(a, 'week', o.tzOffsetMin));
  if (o.silent) parts.push(renderSilentText(a, o.top));
  if (o.sessions) parts.push(renderSessionsText(a, o.top, o.tzOffsetMin));
  if (o.detail) {
    const L = ['-- raw samples --'];
    for (const kv of [...a.sigs.entries()].sort((x, y) => y[1] - x[1]).slice(0, o.top)) {
      const want = kv[0];
      L.push('');
      L.push('### x' + kv[1] + '  ' + want);
      const hits = a.errs.filter((r) => classify(r) + ' | ' + signature(r) === want).slice(0, o.samples);
      for (const r of hits) {
        L.push('  tool=' + r.tool + ' model=' + r.model + ' ' + new Date(r.t).toISOString().slice(0, 19) + ' session=' + String(r.sid).slice(0, 10));
        if (r.args) L.push('  args=' + String(r.args).replace(/\s+/g, ' ').slice(0, 200));
        L.push('  text=' + String(r.tx || '').replace(/\n/g, ' \\n ').slice(0, 500));
      }
    }
    parts.push(L.join('\n'));
  }
  console.log(parts.join('\n\n'));

  if (typeof o.failOver === 'number' && !isNaN(o.failOver)) {
    const rate = 100 * a.errors / Math.max(a.total, 1);
    if (rate > o.failOver) {
      console.error('failure rate ' + rate.toFixed(2) + '% exceeds --fail-over ' + o.failOver + '%');
      return 1;
    }
  }
  return 0;
}

process.exitCode = main();