#!/usr/bin/env npx tsx
// Claude Code Statusline — single file, three modes:
//   statusline  — renders the status bar (reads JSON from stdin)
//   start       — records turn start timestamp (UserPromptSubmit hook)
//   stop        — records turn duration (Stop hook)

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "fs";
import { basename, join } from "path";
import { execSync } from "child_process";
import { homedir, tmpdir } from "os";

// ── ANSI colors ───────────────────────────────────────────────────────────────
const c = {
  blue: "\x1b[38;2;0;153;255m",
  orange: "\x1b[38;2;255;176;85m",
  green: "\x1b[38;2;0;175;80m",
  cyan: "\x1b[38;2;86;182;194m",
  red: "\x1b[38;2;255;85;85m",
  yellow: "\x1b[38;2;230;200;0m",
  white: "\x1b[38;2;220;220;220m",
  magenta: "\x1b[38;2;180;140;255m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

const SEP = ` ${c.dim}│${c.reset} `;
const TMP_DIR = "/tmp/claude";

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureTmpDir() {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    const timeout = setTimeout(() => resolve(data), 3000);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => {
      clearTimeout(timeout);
      resolve(data);
    });
  });
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${n}`;
}

function fmtMs(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${ms}ms`;
}

function colorForPct(pct: number): string {
  if (pct >= 90) return c.red;
  if (pct >= 70) return c.yellow;
  if (pct >= 50) return c.orange;
  return c.green;
}

function buildBar(pct: number, width = 10): string {
  pct = Math.max(0, Math.min(100, pct));
  const filled = Math.floor((pct * width) / 100);
  const remainder = (pct * width) % 100;
  const color = colorForPct(pct);

  let partial = "";
  let hasPartial = false;
  if (remainder > 0 && filled < width) {
    hasPartial = true;
    if (remainder <= 30) partial = "◔";
    else if (remainder <= 65) partial = "◑";
    else partial = "◕";
  }

  const empty = width - filled - (hasPartial ? 1 : 0);
  return `${color}${"●".repeat(filled)}${partial}${c.dim}${"○".repeat(empty)}${c.reset}`;
}

function fmtRelativeTime(isoStr: string | undefined): string {
  if (!isoStr || isoStr === "null") return "";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return "";
    const diffMs = d.getTime() - Date.now();
    if (diffMs <= 0) {
      return d.toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase().replace(/\./g, "");
    }
    const totalMin = Math.floor(diffMs / 60_000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  } catch {
    return "";
  }
}

function fmtResetDateTime(isoStr: string | undefined): string {
  if (!isoStr || isoStr === "null") return "";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase().replace(/\./g, "");
  } catch {
    return "";
  }
}

function exec(cmd: string, cwd?: string): string {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

// ── OAuth token resolution ────────────────────────────────────────────────────

function getOAuthToken(): string {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return process.env.CLAUDE_CODE_OAUTH_TOKEN;

  // macOS keychain
  try {
    const blob = exec('security find-generic-password -s "Claude Code-credentials" -w');
    if (blob) {
      const token = JSON.parse(blob)?.claudeAiOauth?.accessToken;
      if (token) return token;
    }
  } catch {}

  // credentials file
  const credsFile = join(homedir(), ".claude", ".credentials.json");
  if (existsSync(credsFile)) {
    try {
      const token = JSON.parse(readFileSync(credsFile, "utf8"))?.claudeAiOauth?.accessToken;
      if (token) return token;
    } catch {}
  }

  return "";
}

// ── Fetch usage data (cached 60s) ─────────────────────────────────────────────

interface UsageData {
  five_hour?: { utilization: number; resets_at?: string };
  seven_day?: { utilization: number; resets_at?: string };
  extra_usage?: { is_enabled: boolean; utilization: number; used_credits: number; monthly_limit: number };
}

function fetchUsageData(): UsageData | null {
  ensureTmpDir();
  const cacheFile = join(TMP_DIR, "statusline-usage-cache.json");
  const cacheMaxAge = 60;

  if (existsSync(cacheFile)) {
    const age = (Date.now() - statSync(cacheFile).mtimeMs) / 1000;
    if (age < cacheMaxAge) {
      try { return JSON.parse(readFileSync(cacheFile, "utf8")); } catch {}
    }
  }

  const token = getOAuthToken();
  if (token) {
    const response = exec(
      `curl -s --max-time 5 -H "Accept: application/json" -H "Content-Type: application/json" -H "Authorization: Bearer ${token}" -H "anthropic-beta: oauth-2025-04-20" -H "User-Agent: claude-code/2.1.34" "https://api.anthropic.com/api/oauth/usage"`
    );
    if (response) {
      try {
        const data = JSON.parse(response);
        if (data.five_hour) {
          writeFileSync(cacheFile, response);
          return data;
        }
      } catch {}
    }
  }

  if (existsSync(cacheFile)) {
    try { return JSON.parse(readFileSync(cacheFile, "utf8")); } catch {}
  }
  return null;
}

// ── Turn timing stats ─────────────────────────────────────────────────────────

function getTurnStats(sessionId: string): { last: number; avg: number; med: number; max: number; n: number; completedAt: string } | null {
  const histFile = join(TMP_DIR, `turns-${sessionId}.log`);
  if (!existsSync(histFile)) return null;

  const vals = readFileSync(histFile, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d+$/.test(l))
    .map(Number);

  if (vals.length === 0) return null;

  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];

  // Last completion time from file mtime
  const mtime = statSync(histFile).mtimeMs;
  const d = new Date(mtime);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");

  return {
    last: vals[vals.length - 1],
    avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
    med: median,
    max: Math.max(...vals),
    n: vals.length,
    completedAt: `${hh}:${mm}:${ss}`,
  };
}

// ── Mode: start ───────────────────────────────────────────────────────────────

async function modeStart() {
  const raw = await readStdin();
  let sessionId = "unknown";
  try { sessionId = JSON.parse(raw).session_id || "unknown"; } catch {}
  ensureTmpDir();
  writeFileSync(join(TMP_DIR, `turn-start-${sessionId}.ts`), `${Date.now()}`);
}

// ── Mode: stop ────────────────────────────────────────────────────────────────

async function modeStop() {
  const raw = await readStdin();
  let sessionId = "unknown";
  try { sessionId = JSON.parse(raw).session_id || "unknown"; } catch {}

  const startFile = join(TMP_DIR, `turn-start-${sessionId}.ts`);
  if (!existsSync(startFile)) return;

  const startMs = parseInt(readFileSync(startFile, "utf8").trim(), 10);
  const duration = Date.now() - startMs;
  if (duration <= 0) return;

  ensureTmpDir();
  const histFile = join(TMP_DIR, `turns-${sessionId}.log`);

  // Append duration
  const existing = existsSync(histFile) ? readFileSync(histFile, "utf8") : "";
  const lines = existing.split("\n").filter((l) => l.trim());
  lines.push(`${duration}`);
  // Keep last 100
  const trimmed = lines.slice(-100);
  writeFileSync(histFile, trimmed.join("\n") + "\n");

  // Clean up start marker
  try { require("fs").unlinkSync(startFile); } catch {}
}

// ── Mode: statusline ─────────────────────────────────────────────────────────

async function modeStatusline() {
  const raw = await readStdin();
  if (!raw.trim()) {
    process.stdout.write("Claude");
    return;
  }

  const data = JSON.parse(raw);
  const model = data.model?.display_name || "Claude";
  const cwd = data.cwd || data.workspace?.current_dir || process.cwd();
  const dir = basename(cwd);
  const sessionId = data.session_id || "";

  // Context window
  const ctxSize = data.context_window?.context_window_size || 200_000;
  const inputTok = data.context_window?.current_usage?.input_tokens || 0;
  const cacheCreate = data.context_window?.current_usage?.cache_creation_input_tokens || 0;
  const cacheRead = data.context_window?.current_usage?.cache_read_input_tokens || 0;
  const outputTok = data.context_window?.current_usage?.output_tokens || 0;
  const currentTok = inputTok + cacheCreate + cacheRead;
  const pctUsed = ctxSize > 0 ? Math.round((currentTok * 100) / ctxSize) : 0;

  // Cost
  const costUsd = data.cost?.total_cost_usd || 0;
  const costFmt = `$${costUsd.toFixed(3)}`;

  // Effort level
  let effort = "default";
  const settingsPath = join(homedir(), ".claude", "settings.json");
  if (existsSync(settingsPath)) {
    try { effort = JSON.parse(readFileSync(settingsPath, "utf8")).effortLevel || "default"; } catch {}
  }

  // Git
  let gitBranch = "";
  let gitDirty = "";
  if (exec(`git -C "${cwd}" rev-parse --is-inside-work-tree`)) {
    gitBranch = exec(`git -C "${cwd}" symbolic-ref --short HEAD`);
    if (exec(`git -C "${cwd}" status --porcelain`)) gitDirty = "*";
  }

  // Session duration
  let sessionDur = "";
  const sessionStart = data.session?.start_time;
  if (sessionStart) {
    const elapsed = Math.floor((Date.now() - new Date(sessionStart).getTime()) / 1000);
    if (elapsed >= 3600) sessionDur = `${Math.floor(elapsed / 3600)}h${Math.floor((elapsed % 3600) / 60)}m`;
    else if (elapsed >= 60) sessionDur = `${Math.floor(elapsed / 60)}m`;
    else sessionDur = `${elapsed}s`;
  }

  // ── Line 1 ──────────────────────────────────────────────────────────────────
  const parts1: string[] = [
    `${c.blue}${model}${c.reset}`,
    `${c.yellow}${costFmt}${c.reset}`,
    `${c.dim}↑${fmtTokens(outputTok)}${c.reset}`,
    `${c.cyan}${dir}${c.reset}${gitBranch ? ` ${c.green}(${gitBranch}${c.red}${gitDirty}${c.green})${c.reset}` : ""}`,
  ];
  if (sessionDur) parts1.push(`${c.dim}⏱ ${c.reset}${c.white}${sessionDur}${c.reset}`);

  const effortIcon = effort === "high" ? `${c.magenta}●` : `${c.dim}◑`;
  parts1.push(`${effortIcon} ${effort}${c.reset}`);

  const line1 = parts1.join(SEP);

  // ── Stacked bars ────────────────────────────────────────────────────────────
  const barLines: string[] = [];

  // Context bar
  if (ctxSize > 0) {
    const ctxColor = colorForPct(pctUsed);
    barLines.push(
      `${c.white}context${c.reset} ${buildBar(pctUsed)} ${ctxColor}${String(pctUsed).padStart(3)}%${c.reset} ${c.dim}${fmtTokens(currentTok)}/${fmtTokens(ctxSize)}${c.reset}`
    );
  }

  // Rate limits
  const usage = fetchUsageData();
  if (usage) {
    if (usage.five_hour) {
      const pct = Math.round(usage.five_hour.utilization);
      const reset = fmtRelativeTime(usage.five_hour.resets_at);
      barLines.push(
        `${c.white}current${c.reset} ${buildBar(pct)} ${colorForPct(pct)}${String(pct).padStart(3)}%${c.reset} ${c.dim}⟳${c.reset} ${c.white}${reset}${c.reset}`
      );
    }
    if (usage.seven_day) {
      const pct = Math.round(usage.seven_day.utilization);
      const reset = fmtResetDateTime(usage.seven_day.resets_at);
      barLines.push(
        `${c.white}weekly${c.reset}  ${buildBar(pct)} ${colorForPct(pct)}${String(pct).padStart(3)}%${c.reset} ${c.dim}⟳${c.reset} ${c.white}${reset}${c.reset}`
      );
    }
    if (usage.extra_usage?.is_enabled) {
      const pct = Math.round(usage.extra_usage.utilization);
      const used = (usage.extra_usage.used_credits / 100).toFixed(2);
      const limit = (usage.extra_usage.monthly_limit / 100).toFixed(2);
      barLines.push(
        `${c.white}extra${c.reset}   ${buildBar(pct)} ${colorForPct(pct)}$${used}${c.dim}/${c.reset}${c.white}$${limit}${c.reset}`
      );
    }
  }

  // Turn stats
  if (sessionId) {
    const stats = getTurnStats(sessionId);
    if (stats) {
      const parts = [
        `${c.white}turns${c.reset}   ${c.dim}n=${c.reset}${c.white}${stats.n}${c.reset}`,
        `${c.cyan}${fmtMs(stats.last)}${c.reset} ${c.dim}last${c.reset} ${c.dim}@${c.reset}${c.white}${stats.completedAt}${c.reset}`,
        `${c.dim}avg ${c.reset}${c.white}${fmtMs(stats.avg)}${c.reset}`,
        `${c.dim}p50 ${c.reset}${c.white}${fmtMs(stats.med)}${c.reset}`,
        `${c.dim}max ${c.reset}${c.white}${fmtMs(stats.max)}${c.reset}`,
      ];
      barLines.push(parts.join(SEP));
    }
  }

  // Output
  process.stdout.write(line1);
  if (barLines.length > 0) {
    process.stdout.write("\n\n" + barLines.join("\n"));
  }
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

const mode = process.argv[2] || "statusline";

switch (mode) {
  case "start":
    modeStart().catch(() => {});
    break;
  case "stop":
    modeStop().catch(() => {});
    break;
  case "statusline":
    modeStatusline().catch(() => {});
    break;
  default:
    console.error(`Unknown mode: ${mode}`);
    process.exit(1);
}
