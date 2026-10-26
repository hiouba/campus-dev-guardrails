#!/usr/bin/env node
/**
 * 独立 CLI：不开 MCP 也能跑静态扫描
 * 用法：campus-guardrails-lint [project_path] [--json]
 * 退出码：0=PASS 1=有 warn 2=有 error/敏感信息（可接 CI）
 * Copyright (c) 2026 beijingyulanwenhua · hiouba — see LICENSE.md
 */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const fs = require('fs');

// 直接复用 server 的引擎（把 index.js 里 lintProject 抽出来需要小改：用 HTTP 太重，这里用 require 兼容层）
const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
const patched = serverSrc.replace(/\/\* ---------------- JSON-RPC \(stdio\) ---------------- \*\/[\s\S]*$/, '\nmodule.exports = { lintProject, RULES };\n');
process.env.GUARDRAILS_RULES = process.env.GUARDRAILS_RULES || path.join(__dirname, '..', 'rules', 'rules.json');
const tmp = path.join(require('os').tmpdir(), 'cguard_engine_' + process.pid + '.js');
fs.writeFileSync(tmp, patched);
let engine;
try { engine = require(tmp); } finally { fs.rmSync(tmp, { force: true }); }

const target = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : process.cwd();
const asJson = process.argv.includes('--json');

const result = engine.lintProject(path.resolve(target));
result.summary = {
  violations: result.violations.length,
  errors: result.violations.filter(x => x.severity === 'error').length,
  secrets: result.secrets.length,
};
result.verdict = result.summary.secrets > 0 ? 'BLOCK_RELEASE' : (result.summary.errors > 0 ? 'REVIEW' : 'PASS_WITH_WARNINGS');

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log('scanned files: ' + result.scannedFiles);
  for (const v of result.violations) console.log(`  [${v.severity}] ${v.rule} @ ${v.file}:${v.line} — ${v.title}`);
  for (const s of result.secrets) console.log(`  [secret] ${s.pattern} @ ${s.file}:${s.line} — ${s.hint}`);
  console.log(`verdict: ${result.verdict} (errors=${result.summary.errors}, secrets=${result.summary.secrets}, total=${result.summary.violations})`);
}
process.exit(result.summary.secrets > 0 || result.summary.errors > 0 ? 2 : (result.summary.violations > 0 ? 1 : 0));
