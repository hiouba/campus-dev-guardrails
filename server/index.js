#!/usr/bin/env node
/**
 * campus-dev-guardrails MCP server
 * 校园小程序开发护栏 —— 规则查询 + 项目静态扫描 + 提审清单
 * 零运行时依赖：Node >= 18 直接运行
 * Copyright (c) 2026 beijingyulanwenhua · hiouba — see LICENSE.md
 */
'use strict';

const fs = require('fs');
const path = require('path');

function resolveRulesPath() {
  if (process.env.GUARDRAILS_RULES) return process.env.GUARDRAILS_RULES;
  const cands = [
    path.join(__dirname, '..', 'rules', 'rules.json'), // 仓库布局 server/../rules
    path.join(__dirname, 'rules', 'rules.json'),        // 扁平布局
    path.join(process.cwd(), 'rules', 'rules.json'),
  ];
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch (e) {} }
  return cands[0];
}
const RULES_PATH = resolveRulesPath();
let PKG = { version: '0.1.0' };
try { PKG = require('../package.json'); } catch (e) { /* engine 被独立加载时容忍 */ }

let rulesDoc;
try {
  rulesDoc = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
} catch (e) {
  console.error('[guardrails] failed to load rules.json: ' + e.message);
  process.exit(1);
}
const RULES = rulesDoc.rules;
const byId = new Map(RULES.map(r => [r.id, r]));

/* ---------------- static lint engine (lintable rules) ---------------- */

const SCAN_EXTS = new Set(['.vue', '.nvue', '.js', '.ts', '.wxss', '.css', '.scss', '.json']);
const SKIP_DIRS = new Set(['node_modules', 'unpackage', 'dist', '.git', 'H5', 'harmony', 'quickapp']);

function walk(dir, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const ent of ents) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) walk(full, out);
    } else if (SCAN_EXTS.has(path.extname(ent.name))) {
      out.push(full);
    }
  }
}

// Each check: pure function over (file, text) -> violations[]
const CHECKS = [
  {
    rule: 'platform.inline-style-rpx',
    test(file, text) {
      const out = [];
      const re = /:style\s*=\s*(["'`])(?:[^{"']*\{[^}]*?)?[^"'`]*?(-?\d+(?:\.\d+)?)rpx/g;
      let m; let i = 0;
      const lines = text.split('\n');
      while ((m = re.exec(text)) !== null) {
        const upto = text.slice(0, m.index).split('\n').length;
        out.push({ line: upto, snippet: (lines[upto - 1] || '').trim().slice(0, 120) });
        if (++i > 30) break;
      }
      // 也抓静态 style="...rpx..."（非绑定）
      const re2 = /\sstyle\s*=\s*"[^"]*\d+(?:\.\d+)?rpx/;
      lines.forEach((ln, idx) => { if (re2.test(ln)) out.push({ line: idx + 1, snippet: ln.trim().slice(0, 120) }); });
      return out.slice(0, 40);
    },
  },
  {
    rule: 'platform.wxss-no-star',
    test(file, text) {
      if (!/\.(wxss|css|scss)$/.test(file) && !/<style[^>]*lang="(wxss|css|scss)"/.test(text)) {
        if (!/^\s*<(style|style lang)/.test(text) && !/\.(wxss|css|scss)$/.test(file)) return [];
      }
      const out = [];
      const lines = text.split('\n');
      lines.forEach((ln, idx) => {
        const t = ln.trim();
        if (t.startsWith('/*') || t.startsWith('//') || t.startsWith('*') && !t.includes('{')) return;
        if (/(^|[\s{},>+~])\*\s*[,{]/.test(t) || /^\*\s*[,{]/.test(t) || /\.\w+\s+\*\s*[,{]/.test(t) || /^\*\s*\./.test(t)) {
          out.push({ line: idx + 1, snippet: t.slice(0, 120) });
        }
      });
      return out;
    },
  },
  {
    rule: 'platform.wxss-no-pseudo',
    test(file, text) {
      const out = [];
      const lines = text.split('\n');
      lines.forEach((ln, idx) => {
        const t = ln.trim();
        if (t.startsWith('/*') || t.startsWith('//') || t.startsWith('*')) return;
        if (/:(hover|active)\b/.test(t) && /[,{]\s*$|\{\s*\S/.test(t)) out.push({ line: idx + 1, snippet: t.slice(0, 120) });
      });
      return out;
    },
  },
  {
    rule: 'platform.defineprops-ts-type',
    test(file, text) {
      if (!/\.(vue|nvue|ts)$/.test(file)) return [];
      const out = [];
      const lines = text.split('\n');
      lines.forEach((ln, idx) => {
        if (/defineProps\s*(<[^>]+>|\()\s*[^)]*\)?\s*;?\s*$/.test(ln) && /defineProps<\s*\{/.test(ln)) {
          out.push({ line: idx + 1, snippet: ln.trim().slice(0, 120) });
        }
      });
      return out;
    },
  },
  {
    rule: 'packaging.subpackage-asset-location',
    test(file, text) {
      if (!/pages\.json$/.test(file)) return [];
      const out = [];
      try {
        const clean = text.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        const j = JSON.parse(clean);
        const subs = (j.subPackages || j.subpackages || []).map(s => (s.root || '').replace(/\/$/, ''));
        if (!subs.length) return [];
        // 收集分包页面里引用根 static 的路径
        const subPages = new Set();
        for (const s of j.subPackages || j.subpackages || []) {
          for (const p of s.pages || []) subPages.add((s.root + '/' + p.path).replace(/\/+/g, '/'));
        }
        out.push({ line: 0, snippet: `subPackages=${subs.length}; 请人工核对分包页面是否引用了根 /static/ 资源（护栏规则要求资源放分包 root 下 static/）`, info: true });
      } catch (e) { /* jsonc edge */ }
      return out;
    },
  },
  {
    rule: 'packaging.subpackages-switch',
    test(file, text) {
      if (!/manifest\.json$/.test(file)) return [];
      try {
        const clean = text.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        const j = JSON.parse(clean);
        const mp = j['mp-weixin'] || {};
        const opt = mp.optimization || {};
        if (opt.subPackages !== true) {
          return [{ line: 1, snippet: 'manifest.json → mp-weixin.optimization.subPackages 未设为 true，分包资源不会被正确归属（真机 404 风险）' }];
        }
      } catch (e) { /* ignore */ }
      return [];
    },
  },
  {
    rule: 'platform.animation-fill-both',
    test(file, text) {
      const out = [];
      const lines = text.split('\n');
      lines.forEach((ln, idx) => {
        const t = ln.trim();
        if (t.startsWith('/*') || t.startsWith('//')) return;
        if (/animation(-fill-mode)?\s*:[^;]*\b(both|forwards)\b/.test(t)) out.push({ line: idx + 1, snippet: t.slice(0, 120) });
      });
      return out;
    },
  },
  {
    rule: 'engineering.git-history-leak',
    test(file, text) {
      if (!(file.endsWith('.git') || /[\\/]\.git[\\/]/.test(file))) return [];
      return [];
    },
  },
];

// 全包级红线扫描（密钥/内网信息——compliance.client-no-secrets 的 lint 面）
const SECRET_PATTERNS = [
  { name: 'private-ip', re: /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/, hint: '疑似内网 IP 进入源码（生产/调试地址应放配置或环境变量）' },
  { name: 'cloud-key-format', re: /\b(AKID[A-Za-z0-9]{12,}|LTAI[A-Za-z0-9]{12,}|wx[0-9a-f]{16})\b/, hint: '疑似云密钥或真实 AppID 格式' },
  { name: 'bearer-hardcoded', re: /Bearer\s+[A-Za-z0-9_\-\.]{20,}/, hint: '硬编码 Bearer token' },
  { name: 'pwd-assign', re: /(?:password|passwd|secret|api_?key)\s*[:=]\s*['"][^'"]{6,}['"]/i, hint: '疑似硬编码凭据（示例值请改用 CHANGE_ME 风格）' },
  { name: 'panel-path', re: /\/www\/(wwwroot|server\/panel)\b/, hint: '服务器绝对路径进入源码' },
];

function lintProject(root) {
  const files = [];
  walk(root, files);
  const violations = [];
  const secrets = [];
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
    if (text.length > 3_000_000) continue;
    for (const chk of CHECKS) {
      const hits = chk.test(f, text);
      for (const h of hits) {
        const rule = byId.get(chk.rule);
        violations.push({
          rule: chk.rule,
          severity: h.info ? 'info' : rule.sev,
          title: rule.title,
          file: path.relative(root, f),
          line: h.line,
          snippet: h.snippet,
          fix: rule.fix,
        });
      }
    }
    const lines = text.split('\n');
    // lockfile 与编译产物不做机密扫描（sha 哈希会误报 IP/密钥）
    const skipSecrets = /package-lock\.json$|yarn\.lock$|pnpm-lock\.yaml$/.test(f);
    if (!skipSecrets) for (let i = 0; i < lines.length; i++) {
      for (const sp of SECRET_PATTERNS) {
        // 跳过常见占位与文档语境
        if (/example|CHANGE_ME|your[-_]|placeholder|__UNI__X|<.*>|\{\{|xxx|PLACEHOLDER/i.test(lines[i])) continue;
        if (sp.re.test(lines[i]) && !/README|\.md$/.test(f)) {
          secrets.push({ pattern: sp.name, hint: sp.hint, file: path.relative(root, f), line: i + 1, snippet: lines[i].trim().slice(0, 120) });
        }
      }
    }
  }
  return { scannedFiles: files.length, violations, secrets: secrets.slice(0, 60) };
}

/* ---------------- MCP tool layer ---------------- */

function listRules({ category, severity } = {}) {
  let rs = RULES;
  if (category) rs = rs.filter(r => r.cat === category);
  if (severity) rs = rs.filter(r => r.sev === severity);
  return rs.map(r => ({ id: r.id, cat: r.cat, sev: r.sev, title: r.title }));
}

function getRules({ ids, category }) {
  if (ids && ids.length) return RULES.filter(r => ids.includes(r.id));
  if (category) return RULES.filter(r => r.cat === category);
  return RULES;
}

function submitChecklist({ scenario } = {}) {
  const cats = ['compliance', 'packaging'];
  let rs = RULES.filter(r => cats.includes(r.cat));
  if (scenario === 'first-release') {
    rs = rs.concat(RULES.filter(r => ['platform.statusbar-padding', 'platform.401-overlay', 'engineering.compile-fingerprint'].includes(r.id)));
  }
  return {
    scenario: scenario || 'general',
    checklist: rs.map(r => ({ rule: r.id, severity: r.sev, title: r.title, action: r.fix })),
    extra_tips: [
      '上传包体积以开发者工具「本地代码包大小」为准',
      '提审必附体验账号 + 版本描述说明内容边界',
      '隐私接口按「采集即声明」逐项对齐指引',
    ],
  };
}

const TOOLS = {
  list_categories: {
    description: '列出护栏规则分类（platform/packaging/compliance/performance/interaction/engineering）。',
    inputSchema: { type: 'object', properties: {} },
    handler: () => rulesDoc.categories,
  },
  list_rules: {
    description: '列出规则索引，可按 category / severity(error|warn|info) 过滤。返回 id+title，供后续 get_rules 取详情。',
    inputSchema: { type: 'object', properties: { category: { type: 'string' }, severity: { type: 'string', enum: ['error', 'warn', 'info'] } } },
    handler: listRules,
  },
  get_rules: {
    description: '获取规则详情（含症状、成因、修复方案）。传 ids 精确取，或传 category 取整类，都不传取全量。写代码前先按任务场景取对应类规则遵守。',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } }, category: { type: 'string' } } },
    handler: getRules,
  },
  lint_project: {
    description: '对指定 uni-app/微信小程序项目目录做静态护栏扫描：rpx 行内样式、WXSS 通配/伪类、defineProps 泛型、分包开关与资源位置、动画 fill-mode、以及密钥/内网信息泄露红线。返回违规清单（含修复建议）。发版/开源前必跑。',
    inputSchema: { type: 'object', properties: { project_path: { type: 'string', description: '项目根目录绝对路径' } }, required: ['project_path'] },
    handler: ({ project_path }) => {
      const root = path.resolve(project_path || process.cwd());
      if (!fs.existsSync(root)) throw new Error('path not found: ' + root);
      const r = lintProject(root);
      r.summary = { violations: r.violations.length, errors: r.violations.filter(x => x.severity === 'error').length, secrets: r.secrets.length };
      r.verdict = r.secrets.length > 0 ? 'BLOCK_RELEASE: 发现疑似敏感信息' : (r.summary.errors > 0 ? 'REVIEW: 存在 error 级违规' : 'PASS_WITH_WARNINGS');
      return r;
    },
  },
  submit_checklist: {
    description: '生成微信小程序提审/上线前的护栏检查清单。scenario 可选 first-release（首版上线，附加常见卡点）。',
    inputSchema: { type: 'object', properties: { scenario: { type: 'string', enum: ['general', 'first-release'] } } },
    handler: submitChecklist,
  },
};

/* ---------------- JSON-RPC (stdio) ---------------- */

function send(res) { process.stdout.write(JSON.stringify(res) + '\n'); }
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function replyErr(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

const SERVER_INFO = { name: 'campus-dev-guardrails', version: PKG.version };
const PROTOCOL_LATEST = '2025-06-18';

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { continue; }
    handle(msg);
  }
});

function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: (params && params.protocolVersion) || PROTOCOL_LATEST,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: '校园小程序开发护栏。建议工作流：动手写代码前 list_rules(category) 取约束 → 涉及布局/组件/动画时 get_rules(ids) 读修复方案 → 发版或开源前 lint_project(project_path) → 提审前 submit_checklist。severity=error 的规则必须遵守。',
      });
    case 'notifications/initialized':
      return; // notification, no reply
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, {
        tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })),
      });
    case 'tools/call': {
      const tname = params && params.name;
      const tool = TOOLS[tname];
      if (!tool) return replyErr(id, -32602, 'unknown tool: ' + tname);
      try {
        const result = tool.handler(params.arguments || {});
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false });
      } catch (e) {
        return reply(id, { content: [{ type: 'text', text: 'ERROR: ' + e.message }], isError: true });
      }
    }
    default:
      if (id !== undefined) replyErr(id, -32601, 'method not found: ' + method);
  }
}
