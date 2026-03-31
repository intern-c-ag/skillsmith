import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type Provider = "claude" | "opencode";

const VALID_PROVIDERS: Provider[] = ["claude", "opencode"];

export function isValidProvider(value: string): value is Provider {
  return VALID_PROVIDERS.includes(value as Provider);
}

/**
 * Resolve the provider for a project directory.
 *
 * Priority:
 *   1. Explicit CLI flag (passed as `flagOverride`)
 *   2. Project-local config: <projectDir>/.vibe/provider.json
 *   3. Global default:       ~/.config/vibe/provider.json
 *   4. Fallback:             "claude"
 */
export function resolveProvider(projectDir: string, flagOverride?: string): Provider {
  if (flagOverride) {
    if (!isValidProvider(flagOverride)) {
      throw new Error(`Invalid provider "${flagOverride}". Choose: ${VALID_PROVIDERS.join(", ")}`);
    }
    return flagOverride;
  }

  // Project-local
  const local = loadProjectProvider(projectDir);
  if (local) return local;

  // Global default
  const global = loadGlobalProvider();
  if (global) return global;

  return "claude";
}

// ── Project-local persistence ──────────────────────────────────────────────

function projectProviderPath(projectDir: string): string {
  return join(projectDir, ".vibe", "provider.json");
}

function loadProjectProvider(projectDir: string): Provider | null {
  const p = projectProviderPath(projectDir);
  try {
    const data = JSON.parse(readFileSync(p, "utf-8"));
    return isValidProvider(data.provider) ? data.provider : null;
  } catch {
    return null;
  }
}

export function saveProjectProvider(projectDir: string, provider: Provider): void {
  const dir = join(projectDir, ".vibe");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    projectProviderPath(projectDir),
    JSON.stringify({ provider, savedAt: new Date().toISOString() }, null, 2) + "\n",
    "utf-8",
  );
}

// ── Global persistence ─────────────────────────────────────────────────────

function globalProviderPath(): string {
  return join(homedir(), ".config", "vibe", "provider.json");
}

function loadGlobalProvider(): Provider | null {
  try {
    const data = JSON.parse(readFileSync(globalProviderPath(), "utf-8"));
    return isValidProvider(data.provider) ? data.provider : null;
  } catch {
    return null;
  }
}

// ── Interactive prompt ─────────────────────────────────────────────────────

/**
 * Returns true if stdin is a TTY (interactive terminal).
 */
export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY);
}
