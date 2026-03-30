import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { scanRepo } from "./scanner.js";
import { generateSkills, type GeneratedSkill } from "./generator.js";
import { researchStack } from "./research.js";
import { discoverMcps, installMcp, type McpServer } from "./mcp-discovery.js";
import { setupProject } from "./setup.js";
import { isClaudeInstalled, installClaude, launchClaude } from "./claude-manager.js";
import { colors, spinner, banner, ask, confirm, table } from "./ui.js";
import { getSkillsDir, listSkills, getConfig, setConfig } from "./store.js";

interface RunOptions {
  force?: boolean;
  newSession?: boolean;
  noClaude?: boolean;
}

/**
 * Default command: full setup + launch
 */
export async function run(projectDir: string, opts: RunOptions = {}): Promise<void> {
  banner();

  // 1. Setup project
  const setupSpin = spinner("Setting up project...");
  const result = await setupProject(projectDir, opts);
  setupSpin.succeed(
    `Set up .claude/ — ${result.agents} agents, ${result.skills} skills, ${result.commands} commands`
  );

  // 2. Install trained skills if available
  const trained = listSkills();
  if (trained.length > 0) {
    const skillsDest = join(projectDir, ".claude", "skills");
    let installed = 0;
    for (const skill of trained) {
      const dest = join(skillsDest, skill.name);
      if (!existsSync(dest) || opts.force) {
        cpSync(skill.path, dest, { recursive: true });
        installed++;
      }
    }
    if (installed > 0) {
      console.log(colors.dim(`  + ${installed} trained skill(s) from your library`));
    }
  }

  // 3. MCP discovery
  const mcpSpin = spinner("Discovering MCP servers...");
  try {
    const mcps = await discoverMcps(result._stack);
    if (mcps.length > 0) {
      mcpSpin.succeed(`Found ${mcps.length} relevant MCP server(s)`);
      await offerMcpInstall(mcps);
    } else {
      mcpSpin.succeed("No additional MCP servers needed");
    }
  } catch {
    mcpSpin.fail("MCP discovery failed (continuing)");
  }

  // 4. Install Claude Code if needed
  if (!opts.noClaude) {
    if (!isClaudeInstalled()) {
      const installSpin = spinner("Installing Claude Code...");
      const installResult = await installClaude();
      if (installResult.success) {
        installSpin.succeed("Claude Code installed");
      } else {
        installSpin.fail(`Claude Code installation failed: ${installResult.error}`);
        console.log(colors.dim("  Install manually: https://docs.anthropic.com/claude-code"));
        return;
      }
    }

    // 5. Launch
    console.log(`\n${colors.green("✔")} Ready. Launching Claude Code...\n`);
    launchClaude(projectDir, { newSession: opts.newSession });
  } else {
    console.log(`\n${colors.green("✔")} Project set up. Run ${colors.cyan("claude")} to start.`);
  }
}

/**
 * Init: setup without launching
 */
export async function init(projectDir: string, opts: RunOptions = {}): Promise<void> {
  banner();
  await run(projectDir, { ...opts, noClaude: true });
}

/**
 * Train: learn from repos
 */
export async function train(paths: string[]): Promise<void> {
  banner();
  const skillsDir = getSkillsDir();
  const allGenerated: GeneratedSkill[] = [];
  const allMcps: McpServer[] = [];

  for (const p of paths) {
    const repoPath = resolve(p);
    const repoName = basename(repoPath);

    // Scan
    const scanSpin = spinner(`Scanning ${repoName}...`);
    const profile = await scanRepo(repoPath);
    scanSpin.succeed(
      `Scanned ${repoName} — ${profile.stack.languages.join(", ")} / ${profile.stack.frameworks.join(", ") || "no framework"}`
    );

    // Research
    const resSpin = spinner(
      `Researching best practices for ${profile.stack.frameworks.join(", ") || profile.stack.languages.join(", ")}...`
    );
    let research;
    try {
      research = await researchStack(profile.stack, repoName);
      resSpin.succeed(`Found ${research.length} research topic(s)`);
    } catch {
      resSpin.fail("Research failed (continuing without web context)");
      research = undefined;
    }

    // MCP discovery
    const mcpSpin = spinner("Discovering MCP servers...");
    try {
      const mcps = await discoverMcps(profile.stack);
      allMcps.push(...mcps);
      mcpSpin.succeed(`Found ${mcps.length} relevant MCP server(s)`);
    } catch {
      mcpSpin.fail("MCP discovery failed (continuing)");
    }

    // Generate
    const genSpin = spinner(`Generating skills for ${repoName}...`);
    const generated = await generateSkills(profile, skillsDir, research);
    genSpin.succeed(`Generated ${generated.length} skill(s)`);

    allGenerated.push(...generated);
  }

  if (allGenerated.length === 0) {
    console.log(colors.yellow("No skills generated."));
    return;
  }

  console.log(colors.green(`\n✔ Generated ${allGenerated.length} skill(s):\n`));
  table([
    ["Name", "Description", "Category"],
    ...allGenerated.map((s) => [s.name, s.description ?? "", s.category ?? ""]),
  ]);

  // MCP install
  if (allMcps.length > 0) {
    const unique = dedup(allMcps);
    await offerMcpInstall(unique);
  }

  // Push
  const shouldPush = await confirm("\nPush skills to GitHub?");
  if (shouldPush) {
    await push();
  }
}

/**
 * MCP: standalone MCP discovery for current project
 */
export async function mcp(projectDir: string): Promise<void> {
  banner();

  const scanSpin = spinner("Detecting project stack...");
  const profile = await scanRepo(projectDir);
  scanSpin.succeed(
    `${profile.stack.languages.join(", ")} / ${profile.stack.frameworks.join(", ") || "no framework"}`
  );

  const mcpSpin = spinner("Discovering MCP servers...");
  const mcps = await discoverMcps(profile.stack);
  mcpSpin.succeed(`Found ${mcps.length} MCP server(s)`);

  if (mcps.length === 0) {
    console.log(colors.dim("No relevant MCP servers found."));
    return;
  }

  await offerMcpInstall(dedup(mcps));
}

/**
 * Push skills to GitHub
 */
export async function push(remote?: string): Promise<void> {
  const skillsDir = getSkillsDir();

  if (!remote) {
    remote = await ask("GitHub repo name (e.g. my-skills): ");
  }
  remote = remote.trim();

  try {
    execSync(`gh repo view ${remote}`, { stdio: "ignore" });
  } catch {
    const spin = spinner(`Creating GitHub repo ${remote}...`);
    execSync(`gh repo create ${remote} --public --confirm`, { stdio: "ignore" });
    spin.succeed(`Created ${remote}`);
  }

  if (!existsSync(join(skillsDir, ".git"))) {
    execSync("git init", { cwd: skillsDir, stdio: "ignore" });
  }

  let repoUrl: string;
  try {
    repoUrl = execSync(`gh repo view ${remote} --json url -q .url`, { encoding: "utf-8" }).trim();
  } catch {
    repoUrl = `https://github.com/${remote}`;
  }

  try {
    execSync(`git remote add origin ${repoUrl}.git`, { cwd: skillsDir, stdio: "ignore" });
  } catch {
    execSync(`git remote set-url origin ${repoUrl}.git`, { cwd: skillsDir, stdio: "ignore" });
  }

  execSync("git add -A", { cwd: skillsDir, stdio: "ignore" });
  try {
    execSync('git commit -m "Update skills"', { cwd: skillsDir, stdio: "ignore" });
  } catch {}

  const pushSpin = spinner("Pushing to GitHub...");
  execSync("git push -u origin main 2>/dev/null || git push -u origin master", {
    cwd: skillsDir,
    stdio: "ignore",
  });
  pushSpin.succeed("Pushed");

  console.log(colors.green(`\n✔ Skills pushed to ${repoUrl}`));
}

/**
 * List trained skills
 */
export function list(): void {
  const skills = listSkills();
  if (skills.length === 0) {
    console.log(colors.yellow("No trained skills. Run `vibe train` first."));
    return;
  }
  table([
    ["Name", "Description", "Category", "Source"],
    ...skills.map((s) => [s.name, s.description ?? "", s.category ?? "", s.sourceRepo ?? ""]),
  ]);
}

/**
 * Config
 */
export function config(key?: string, value?: string): void {
  if (!key) {
    console.log(JSON.stringify(getConfig(), null, 2));
    return;
  }
  if (value === undefined) {
    const cfg = getConfig();
    const val = (cfg as Record<string, unknown>)[key];
    if (val === undefined) {
      console.log(colors.yellow(`Config key "${key}" not set.`));
    } else {
      console.log(`${key} = ${JSON.stringify(val)}`);
    }
    return;
  }
  setConfig(key, value);
  console.log(colors.green(`✔ ${key} = ${JSON.stringify(value)}`));
}

// --- Helpers ---

function dedup(mcps: McpServer[]): McpServer[] {
  const seen = new Set<string>();
  return mcps.filter((m) => {
    if (seen.has(m.name)) return false;
    seen.add(m.name);
    return true;
  });
}

async function offerMcpInstall(mcps: McpServer[]): Promise<void> {
  console.log(colors.bold("\n📡 Recommended MCP servers:\n"));
  mcps.forEach((m, i) => {
    console.log(`  ${colors.cyan(`[${i + 1}]`)} ${colors.bold(m.name)} — ${m.description}`);
    console.log(`      ${colors.dim(m.installCmd)}`);
  });

  const answer = await ask('\nInstall MCP servers? (comma-separated numbers, "all", or "skip"): ');
  if (answer.trim().toLowerCase() === "skip") return;

  let toInstall: McpServer[];
  if (answer.trim().toLowerCase() === "all") {
    toInstall = mcps;
  } else {
    const indices = answer.split(",").map((n) => parseInt(n.trim(), 10) - 1);
    toInstall = indices.filter((i) => i >= 0 && i < mcps.length).map((i) => mcps[i]);
  }

  for (const m of toInstall) {
    const spin = spinner(`Installing ${m.name}...`);
    const ok = await installMcp(m);
    if (ok) spin.succeed(`Installed ${m.name}`);
    else spin.fail(`Failed to install ${m.name}`);
  }
}
