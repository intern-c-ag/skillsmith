/**
 * Scope Wizard — interactive per-repo training scope configuration.
 *
 * On first `vibe train .`, prompts user to tag top-level entries as:
 *   core | reference | deps/generated | ignore
 *
 * Persisted in `.vibe/scope.json` inside the target repo.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import * as readline from "node:readline";
import { colors } from "./ui.js";

// ── Types ─────────────────────────────────────────────────────────────────

export type ScopeTag = "core" | "reference" | "deps/generated" | "ignore";

export interface ScopeEntry {
  name: string;
  tag: ScopeTag;
}

export interface ScopeConfig {
  version: 1;
  entries: ScopeEntry[];
  createdAt: string;
  updatedAt: string;
}

/** Weights applied during deep scan based on scope tags */
export interface ScopeWeights {
  /** Paths to include in deep scan (core + reference) */
  includePaths: string[];
  /** Paths to fully exclude from scan */
  excludePaths: string[];
  /** Paths treated as reference (lower weight) */
  referencePaths: string[];
  /** Paths treated as core (full weight) */
  corePaths: string[];
}

// ── Persistence ───────────────────────────────────────────────────────────

const SCOPE_DIR = ".vibe";
const SCOPE_FILE = "scope.json";

function scopePath(repoRoot: string): string {
  return join(repoRoot, SCOPE_DIR, SCOPE_FILE);
}

export function loadScopeConfig(repoRoot: string): ScopeConfig | null {
  const p = scopePath(repoRoot);
  if (!existsSync(p)) return null;
  try {
    const raw = readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1 && Array.isArray(parsed.entries)) return parsed as ScopeConfig;
    return null;
  } catch {
    return null;
  }
}

export function saveScopeConfig(repoRoot: string, config: ScopeConfig): void {
  const dir = join(repoRoot, SCOPE_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(scopePath(repoRoot), JSON.stringify(config, null, 2) + "\n", "utf-8");
}

// ── Defaults / heuristics ─────────────────────────────────────────────────

const DEPS_PATTERNS = /^(node_modules|vendor|\.venv|venv|__pycache__|\.next|\.nuxt|dist|build|out|target|\.gradle|\.cache|\.tox|coverage|\.nyc_output|\.turbo)$/;
const GENERATED_PATTERNS = /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Gemfile\.lock|poetry\.lock|Cargo\.lock|go\.sum|composer\.lock)$/;
const IGNORE_PATTERNS = /^(\.[a-z]+)$/; // dotfiles/dotdirs not otherwise classified
const REFERENCE_PATTERNS = /^(reference|examples|docs|doc|wiki|specs|spec|samples|demo|demos|fixtures|testdata|test-data)$/i;

function guessTag(name: string, isDir: boolean): ScopeTag {
  if (DEPS_PATTERNS.test(name)) return "deps/generated";
  if (!isDir && GENERATED_PATTERNS.test(name)) return "deps/generated";
  if (REFERENCE_PATTERNS.test(name)) return "reference";
  if (isDir && IGNORE_PATTERNS.test(name) && name !== ".vibe") return "ignore";
  return "core";
}

// ── Top-level entry discovery ─────────────────────────────────────────────

interface TopLevelEntry {
  name: string;
  isDir: boolean;
  suggestedTag: ScopeTag;
}

function discoverTopLevel(repoRoot: string): TopLevelEntry[] {
  const entries: TopLevelEntry[] = [];
  for (const name of readdirSync(repoRoot).sort()) {
    if (name === ".git" || name === ".vibe") continue;
    let isDir = false;
    try {
      isDir = statSync(join(repoRoot, name)).isDirectory();
    } catch {
      continue;
    }
    entries.push({ name, isDir, suggestedTag: guessTag(name, isDir) });
  }
  return entries;
}

// ── Interactive terminal selector ─────────────────────────────────────────

const TAG_ORDER: ScopeTag[] = ["core", "reference", "deps/generated", "ignore"];
const TAG_COLORS: Record<ScopeTag, (s: string) => string> = {
  core: colors.green,
  reference: colors.cyan,
  "deps/generated": colors.yellow,
  ignore: colors.dim,
};

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * Run the interactive scope wizard.
 * Returns null if user declines or non-interactive.
 */
export async function runScopeWizard(
  repoRoot: string,
  opts: { editExisting?: boolean } = {},
): Promise<ScopeConfig | null> {
  if (!isInteractive()) return null;

  const existing = loadScopeConfig(repoRoot);
  if (!opts.editExisting && existing) return existing; // already configured

  // Prompt to enter wizard (unless --edit-scope)
  if (!opts.editExisting) {
    const answer = await askLine("Configure training scope now? [Y/n] ");
    if (answer.toLowerCase() === "n") return null;
  }

  const topLevel = discoverTopLevel(repoRoot);
  if (topLevel.length === 0) {
    console.log(colors.dim("  No top-level entries found."));
    return null;
  }

  // Merge existing tags if editing
  const existingMap = new Map<string, ScopeTag>();
  if (existing) {
    for (const e of existing.entries) existingMap.set(e.name, e.tag);
  }

  // Initialize tags from existing or suggestions
  const tags: ScopeTag[] = topLevel.map((e) =>
    existingMap.has(e.name) ? existingMap.get(e.name)! : e.suggestedTag,
  );

  // Run interactive selector
  const result = await interactiveSelect(topLevel, tags);
  if (!result) return null;

  const now = new Date().toISOString();
  const config: ScopeConfig = {
    version: 1,
    entries: topLevel.map((e, i) => ({ name: e.name, tag: result[i] })),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  saveScopeConfig(repoRoot, config);
  console.log(colors.green(`✔ Scope saved to ${SCOPE_DIR}/${SCOPE_FILE}`));
  return config;
}

async function interactiveSelect(
  entries: TopLevelEntry[],
  tags: ScopeTag[],
): Promise<ScopeTag[] | null> {
  let cursor = 0;
  const result = [...tags];

  return new Promise<ScopeTag[] | null>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // Raw mode for keypress detection
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    readline.emitKeypressEvents(process.stdin, rl);

    const render = () => {
      // Move up to clear previous render
      const lines = entries.length + 3;
      process.stdout.write(`\x1b[${lines}A\x1b[J`);
      printUI();
    };

    const printUI = () => {
      console.log(colors.bold("\n  Scope Wizard — tag each entry (↑/↓ move, ←/→ or Space cycle tag, Enter confirm, q quit)\n"));
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const tag = result[i];
        const prefix = i === cursor ? colors.cyan("❯") : " ";
        const kind = e.isDir ? "[DIR]" : "[FILE]";
        const tagStr = TAG_COLORS[tag](`[${tag}]`);
        const name = i === cursor ? colors.bold(e.name) : e.name;
        console.log(`  ${prefix} ${kind} ${name.padEnd(30)} ${tagStr}`);
      }
    };

    // Initial render
    printUI();

    const onKeypress = (_ch: string, key: readline.Key) => {
      if (!key) return;

      if (key.name === "q" || (key.ctrl && key.name === "c")) {
        cleanup();
        resolve(null);
        return;
      }

      if (key.name === "return") {
        cleanup();
        resolve(result);
        return;
      }

      if (key.name === "up") {
        cursor = (cursor - 1 + entries.length) % entries.length;
        render();
        return;
      }

      if (key.name === "down") {
        cursor = (cursor + 1) % entries.length;
        render();
        return;
      }

      if (key.name === "space" || key.name === "right") {
        const idx = TAG_ORDER.indexOf(result[cursor]);
        result[cursor] = TAG_ORDER[(idx + 1) % TAG_ORDER.length];
        render();
        return;
      }

      if (key.name === "left") {
        const idx = TAG_ORDER.indexOf(result[cursor]);
        result[cursor] = TAG_ORDER[(idx - 1 + TAG_ORDER.length) % TAG_ORDER.length];
        render();
        return;
      }
    };

    const cleanup = () => {
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      rl.close();
    };

    process.stdin.on("keypress", onKeypress);
  });
}

function askLine(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(`${colors.cyan("?")} ${prompt}`, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── Scope → scan behavior translation ─────────────────────────────────────

export function scopeToWeights(config: ScopeConfig): ScopeWeights {
  const corePaths: string[] = [];
  const referencePaths: string[] = [];
  const excludePaths: string[] = [];
  const includePaths: string[] = [];

  for (const entry of config.entries) {
    switch (entry.tag) {
      case "core":
        corePaths.push(entry.name);
        includePaths.push(entry.name);
        break;
      case "reference":
        referencePaths.push(entry.name);
        includePaths.push(entry.name);
        break;
      case "deps/generated":
      case "ignore":
        excludePaths.push(entry.name);
        break;
    }
  }

  return { includePaths, excludePaths, referencePaths, corePaths };
}

/**
 * Convert scope weights into exclude patterns suitable for deep scanner.
 */
export function scopeToExcludePatterns(weights: ScopeWeights): string[] {
  return weights.excludePaths.map((p) => `${p}/**`);
}

/**
 * Check if a file path falls under a reference scope entry (lower weight).
 */
export function isReferencePath(filePath: string, weights: ScopeWeights): boolean {
  return weights.referencePaths.some(
    (ref) => filePath === ref || filePath.startsWith(ref + "/"),
  );
}
