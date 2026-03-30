import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, extname, basename } from "node:path";
import { execSync } from "node:child_process";

export interface ProjectContext {
  name: string;
  path: string;
  /** What this project IS — derived from README, docs, package description */
  identity: string;
  /** Full directory tree */
  structure: string[];
  /** All source files with content */
  sourceFiles: FileEntry[];
  /** Documentation files (README, .md, docs/) */
  docs: FileEntry[];
  /** Reference materials (reference/, examples/, etc.) */
  references: FileEntry[];
  /** Config/manifest files */
  manifests: FileEntry[];
  /** Stack detection */
  stack: StackInfo;
  /** Total files scanned */
  totalScanned: number;
  /** Total files skipped */
  totalSkipped: number;
}

export interface FileEntry {
  path: string;
  content: string;
  language: string;
  lines: number;
  category: "source" | "doc" | "reference" | "manifest" | "test";
}

export interface StackInfo {
  languages: string[];
  frameworks: string[];
  buildTools: string[];
  testing: string[];
  database: string[];
  runtime: string;
}

// Progress callback: called for each file being processed
export type ProgressCallback = (file: string, stats: { scanned: number; skipped: number; total: number }) => void;

// ── Skip lists ────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  // VCS
  ".git", ".svn", ".hg",
  // JS/TS
  "node_modules", "dist", "build", ".next", ".nuxt", ".output", ".svelte-kit",
  ".turbo", ".vercel", ".cache", ".parcel-cache", "out", "storybook-static",
  // Python
  "__pycache__", ".venv", "venv", ".eggs", ".mypy_cache", ".pytest_cache",
  ".ruff_cache", ".tox", "site-packages", "htmlcov",
  // Rust
  "target",
  // Java/Kotlin
  ".gradle", ".m2", ".mvn", ".idea", "classes",
  // .NET
  "bin", "obj", "packages",
  // Ruby/PHP
  ".bundle", "vendor",
  // Dart/Flutter
  ".dart_tool", ".pub-cache",
  // Elixir
  "_build", "deps",
  // iOS
  "Pods", "DerivedData",
  // Terraform
  ".terraform",
  // General
  "coverage", ".nyc_output", "tmp", "temp", "logs",
  // IDE
  ".vscode", ".vs", ".eclipse", ".settings",
]);

const SKIP_FILE_PATTERNS = [
  // Lock files
  /^package-lock\.json$/, /^yarn\.lock$/, /^pnpm-lock\.yaml$/, /^bun\.lockb$/,
  /^Gemfile\.lock$/, /^poetry\.lock$/, /^Pipfile\.lock$/, /^composer\.lock$/,
  /^Cargo\.lock$/, /^go\.sum$/, /^pubspec\.lock$/,
  // Binary & media
  /\.(png|jpg|jpeg|gif|ico|svg|webp|bmp|tiff)$/i,
  /\.(woff2?|ttf|eot|otf)$/i,
  /\.(mp3|mp4|avi|mov|wav|ogg|webm)$/i,
  /\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$/i,
  /\.(zip|tar|gz|bz2|rar|7z|dmg|iso|jar|war)$/i,
  /\.(exe|dll|so|dylib|o|a|pyc|pyo|class|wasm)$/i,
  /\.(sqlite|db|mdb)$/i,
  // Source maps & minified
  /\.map$/, /\.min\.(js|css)$/, /\.bundle\.(js|css)$/,
  // Data
  /\.(csv|tsv)$/i,
];

const SENSITIVE_PATTERNS = [
  /^\.env/i, /\.env\./i, /secrets/i, /credentials/i,
  /\.key$/, /\.pem$/, /\.p12$/, /\.pfx$/, /\.crt$/,
  /\.keystore$/, /\.jks$/, /id_rsa/, /id_ed25519/,
  /\.htpasswd$/, /\.netrc$/, /\.npmrc$/, /\.pypirc$/,
];

const SENSITIVE_CONTENT = /(?:secret|password|passwd|token|api_key|apikey|private_key|access_key|secret_key|auth_token|bearer|jwt_secret|encryption_key|signing_key|client_secret|database_url|connection_string)\s*[:=]/i;

const LANG_MAP: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescript", ".js": "javascript", ".jsx": "javascript",
  ".py": "python", ".go": "go", ".rs": "rust", ".java": "java", ".rb": "ruby",
  ".php": "php", ".cs": "csharp", ".cpp": "cpp", ".c": "c", ".swift": "swift",
  ".kt": "kotlin", ".scala": "scala", ".vue": "vue", ".svelte": "svelte",
  ".html": "html", ".css": "css", ".scss": "scss", ".sql": "sql",
  ".sh": "shell", ".bash": "shell", ".zsh": "shell",
  ".yaml": "yaml", ".yml": "yaml", ".json": "json", ".toml": "toml",
  ".md": "markdown", ".mdx": "markdown",
  ".graphql": "graphql", ".gql": "graphql",
  ".sol": "solidity", ".circom": "circom", ".zok": "zokrates",
  ".asm": "assembly", ".s": "assembly",
  ".cairo": "cairo", ".move": "move", ".noir": "noir",
};

// ── Helpers ───────────────────────────────────────────────────────────────

function shouldSkipDir(name: string): boolean {
  return SKIP_DIRS.has(name) || name.startsWith(".");
}

function shouldSkipFile(name: string, relPath: string): boolean {
  if (SKIP_FILE_PATTERNS.some(p => p.test(name))) return true;
  if (SENSITIVE_PATTERNS.some(p => p.test(name) || p.test(relPath))) return true;
  return false;
}

function hasSensitiveContent(content: string): boolean {
  const head = content.slice(0, 4000);
  return SENSITIVE_CONTENT.test(head);
}

function categorizeFile(relPath: string, ext: string): FileEntry["category"] {
  const lower = relPath.toLowerCase();
  // Reference materials
  if (lower.startsWith("reference/") || lower.startsWith("references/") ||
      lower.startsWith("examples/") || lower.startsWith("vendor-ref/") ||
      lower.startsWith("docs/examples/")) return "reference";
  // Docs
  if (ext === ".md" || ext === ".mdx" || ext === ".rst" || ext === ".txt" ||
      lower.startsWith("docs/") || lower.startsWith("doc/") ||
      lower.includes("/docs/") || lower.includes("/doc/")) return "doc";
  // Manifests
  if (["package.json", "cargo.toml", "go.mod", "pyproject.toml", "anchor.toml",
       "tsconfig.json", "app.json", "pubspec.yaml", "dockerfile", "docker-compose.yml",
       "makefile", "justfile", ".eslintrc.json", "biome.json"].includes(basename(lower))) return "manifest";
  // Tests
  if (/test|spec|__tests__/.test(lower)) return "test";
  // Source
  return "source";
}

function getLanguage(ext: string): string {
  return LANG_MAP[ext.toLowerCase()] || ext.slice(1) || "unknown";
}

// ── Main scanner ──────────────────────────────────────────────────────────

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

async function* walkFiles(
  dir: string,
  root: string,
  maxDepth = 20,
  depth = 0,
): AsyncGenerator<{ absPath: string; relPath: string }> {
  if (depth > maxDepth) return;

  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }

  for (const entry of entries) {
    const absPath = join(dir, entry.name);
    const relPath = relative(root, absPath);

    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      yield* walkFiles(absPath, root, maxDepth, depth + 1);
    } else if (entry.isFile()) {
      yield { absPath, relPath };
    }
  }
}

export async function deepScan(
  projectDir: string,
  onProgress?: ProgressCallback,
): Promise<ProjectContext> {
  const absRoot = join(projectDir);
  const name = basename(absRoot);
  const stats = { scanned: 0, skipped: 0, total: 0 };

  const sourceFiles: FileEntry[] = [];
  const docs: FileEntry[] = [];
  const references: FileEntry[] = [];
  const manifests: FileEntry[] = [];
  const structure: string[] = [];
  const langCounts = new Map<string, number>();

  // Count total files first for progress
  for await (const _ of walkFiles(absRoot, absRoot)) {
    stats.total++;
  }

  // Now scan with progress
  for await (const { absPath, relPath } of walkFiles(absRoot, absRoot)) {
    const fileName = basename(relPath);
    const ext = extname(fileName).toLowerCase();

    // Skip check
    if (shouldSkipFile(fileName, relPath)) {
      stats.skipped++;
      onProgress?.(relPath, stats);
      continue;
    }

    // Read file
    let content: string;
    try {
      const buf = await readFile(absPath);
      // Skip binary files (check for null bytes in first 512 bytes)
      const head = buf.subarray(0, 512);
      if (head.includes(0)) {
        stats.skipped++;
        onProgress?.(relPath, stats);
        continue;
      }
      content = buf.toString("utf-8");
    } catch {
      stats.skipped++;
      continue;
    }

    // Sensitive content check
    if (hasSensitiveContent(content)) {
      stats.skipped++;
      onProgress?.(relPath, stats);
      continue;
    }

    stats.scanned++;
    onProgress?.(relPath, stats);

    const language = getLanguage(ext);
    const category = categorizeFile(relPath, ext);
    const lines = content.split("\n").length;

    // Track languages
    if (category === "source" && LANG_MAP[ext]) {
      langCounts.set(language, (langCounts.get(language) || 0) + lines);
    }

    const entry: FileEntry = { path: relPath, content, language, lines, category };

    switch (category) {
      case "reference": references.push(entry); break;
      case "doc": docs.push(entry); break;
      case "manifest": manifests.push(entry); break;
      default: sourceFiles.push(entry); break;
    }

    // Build structure
    const parts = relPath.split("/");
    if (parts.length <= 4) {
      structure.push(relPath);
    }
  }

  // Detect stack from manifests
  const stack = detectStackFromManifests(manifests, langCounts, absRoot);

  // Build identity from README + package description
  const identity = buildIdentity(name, docs, manifests);

  return {
    name,
    path: absRoot,
    identity,
    structure,
    sourceFiles,
    docs,
    references,
    manifests,
    stack,
    totalScanned: stats.scanned,
    totalSkipped: stats.skipped,
  };
}

function buildIdentity(name: string, docs: FileEntry[], manifests: FileEntry[]): string {
  const parts: string[] = [];

  // From README
  const readme = docs.find(d =>
    /^readme/i.test(basename(d.path))
  );
  if (readme) {
    // Take first ~2000 chars of README
    parts.push(readme.content.slice(0, 2000));
  }

  // From package.json description
  const pkg = manifests.find(m => basename(m.path) === "package.json");
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg.content);
      if (parsed.description) parts.push(`Package description: ${parsed.description}`);
    } catch {}
  }

  // From Cargo.toml description
  const cargo = manifests.find(m => basename(m.path).toLowerCase() === "cargo.toml");
  if (cargo) {
    const descMatch = cargo.content.match(/description\s*=\s*"([^"]+)"/);
    if (descMatch) parts.push(`Crate description: ${descMatch[1]}`);
  }

  return parts.join("\n\n") || `Project: ${name}`;
}

function detectStackFromManifests(
  manifests: FileEntry[],
  langCounts: Map<string, number>,
  rootDir: string,
): StackInfo {
  const info: StackInfo = {
    languages: [],
    frameworks: [],
    buildTools: [],
    testing: [],
    database: [],
    runtime: "",
  };

  // Languages from line counts
  const sortedLangs = [...langCounts.entries()].sort((a, b) => b[1] - a[1]);
  info.languages = sortedLangs.slice(0, 5).map(([lang]) => lang);

  // Parse manifests for frameworks/tools
  for (const m of manifests) {
    const name = basename(m.path).toLowerCase();
    const content = m.content;

    if (name === "package.json") {
      try {
        const pkg = JSON.parse(content);
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (allDeps.react) info.frameworks.push("react");
        if (allDeps["react-native"]) info.frameworks.push("react-native");
        if (allDeps.expo) info.frameworks.push("expo");
        if (allDeps.next) info.frameworks.push("next.js");
        if (allDeps.vue) info.frameworks.push("vue");
        if (allDeps.svelte) info.frameworks.push("svelte");
        if (allDeps.express) info.frameworks.push("express");
        if (allDeps["@solana/web3.js"]) info.frameworks.push("solana");
        if (allDeps["@coral-xyz/anchor"]) info.frameworks.push("anchor");
        if (allDeps.vitest) info.testing.push("vitest");
        if (allDeps.jest) info.testing.push("jest");
        if (allDeps["@playwright/test"]) info.testing.push("playwright");
        info.runtime = info.runtime || "node";
      } catch {}
    }

    if (name === "cargo.toml") {
      if (/solana-program|solana-sdk|anchor-lang|pinocchio/.test(content)) {
        info.frameworks.push("solana");
      }
      if (/anchor-lang/.test(content)) info.frameworks.push("anchor");
      info.runtime = info.runtime || "rust";
    }

    if (name === "anchor.toml") {
      info.frameworks.push("anchor");
      if (!info.frameworks.includes("solana")) info.frameworks.push("solana");
    }

    if (name === "dockerfile") info.buildTools.push("docker");
  }

  // Check for circom files in source
  // (detected via language counts)
  if (langCounts.has("circom")) info.frameworks.push("circom");
  if (langCounts.has("assembly")) info.frameworks.push("sbpf");
  if (langCounts.has("cairo")) info.frameworks.push("cairo");
  if (langCounts.has("noir")) info.frameworks.push("noir");

  // Dedup
  info.languages = [...new Set(info.languages)];
  info.frameworks = [...new Set(info.frameworks)];
  info.buildTools = [...new Set(info.buildTools)];
  info.testing = [...new Set(info.testing)];

  return info;
}
