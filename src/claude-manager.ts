import { execSync, spawnSync, spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { platform, homedir } from "os";

type Platform = "windows" | "macos" | "linux";

export function detectPlatform(): Platform {
  const p = platform();
  if (p === "win32") return "windows";
  if (p === "darwin") return "macos";
  return "linux";
}

export function commandExists(cmd: string): boolean {
  try {
    const check = detectPlatform() === "windows" ? "where" : "which";
    execSync(`${check} ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function isClaudeInstalled(): boolean {
  return commandExists("claude");
}

export function isNpmInstallation(): boolean {
  if (!isClaudeInstalled()) return false;
  try {
    const check = detectPlatform() === "windows" ? "where" : "which";
    const result = execSync(`${check} claude`, { encoding: "utf-8" }).trim();
    return result.includes("node_modules");
  } catch {
    return false;
  }
}

export async function installClaude(): Promise<{
  success: boolean;
  alreadyInstalled: boolean;
  migrated?: boolean;
  error?: string;
}> {
  if (isClaudeInstalled() && !isNpmInstallation()) {
    return { success: true, alreadyInstalled: true };
  }

  // Migrate from npm to native
  if (isNpmInstallation()) {
    try {
      execSync("claude install", { stdio: "inherit" });
      return { success: true, alreadyInstalled: false, migrated: true };
    } catch (e: any) {
      return { success: false, alreadyInstalled: false, migrated: false, error: e.message };
    }
  }

  const plat = detectPlatform();
  try {
    if (plat === "windows") {
      // Try PowerShell first
      const ps = spawnSync("powershell", ["-Command", "irm https://claude.ai/install.ps1 | iex"], {
        stdio: "inherit",
      });
      if (ps.status !== 0) {
        return { success: false, alreadyInstalled: false, error: "PowerShell installer failed" };
      }
    } else {
      execSync("curl -fsSL https://claude.ai/install.sh | bash", { stdio: "inherit" });
    }
    return { success: true, alreadyInstalled: false };
  } catch (e: any) {
    return { success: false, alreadyInstalled: false, error: e.message };
  }
}

export function hasExistingSession(projectDir: string): boolean {
  try {
    const absPath = join(projectDir).replace(/\//g, "-").replace(/^-/, "");
    // Claude encodes paths by replacing path separators
    const encoded = absPath.replace(/\\/g, "-").replace(/:/g, "");
    const sessionsFile = join(homedir(), ".claude", "projects", encoded, "sessions-index.json");
    if (!existsSync(sessionsFile)) return false;
    const data = JSON.parse(readFileSync(sessionsFile, "utf-8"));
    return Array.isArray(data) ? data.length > 0 : Object.keys(data).length > 0;
  } catch {
    return false;
  }
}

export function launchClaude(
  cwd: string,
  options?: { newSession?: boolean; dangerouslySkipPermissions?: boolean },
): void {
  if (!isClaudeInstalled()) {
    throw new Error("Claude Code is not installed. Run installClaude() first.");
  }

  const args: string[] = [];
  const skipPerms = options?.dangerouslySkipPermissions ?? true;
  if (skipPerms) args.push("--dangerously-skip-permissions");
  if (!options?.newSession && hasExistingSession(cwd)) args.push("-c");

  const child = spawn("claude", args, {
    cwd,
    stdio: "inherit",
    shell: detectPlatform() === "windows",
  });

  child.on("error", (err) => {
    console.error(`Failed to launch Claude: ${err.message}`);
    process.exit(1);
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}
