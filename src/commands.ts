import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { scanRepo } from "./scanner.js";
import { deepScan, type ProjectContext } from "./deep-scanner.js";
import { generateSkills, type GeneratedSkill } from "./generator.js";
import { researchStack } from "./research.js";
import { discoverMcps, installMcp, type McpServer } from "./mcp-discovery.js";
import { setupProject } from "./setup.js";
import { isClaudeInstalled, installClaude, launchClaude } from "./claude-manager.js";
import { colors, spinner, banner, ask, confirm, table, progressBar } from "./ui.js";
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

interface TrainOptions {
  contextFiles?: string[];
}

/**
 * Train: deep-learn from repos
 */
export async function train(paths: string[], opts: TrainOptions = {}): Promise<void> {
  banner();
  const skillsDir = getSkillsDir();
  const allGenerated: GeneratedSkill[] = [];
  const allMcps: McpServer[] = [];

  for (const p of paths) {
    const repoPath = resolve(p);
    const repoName = basename(repoPath);

    // 1. Deep scan — reads every file, shows progress
    console.log(colors.bold(`\n📂 Scanning ${repoName}...\n`));
    const context = await deepScan(repoPath, (file, stats) => {
      const done = stats.scanned + stats.skipped;
      const bar = progressBar(done, stats.total);
      const truncFile = file.length > 50 ? "..." + file.slice(-47) : file;
      const line = `  ${bar}  ${colors.cyan(truncFile)}`;
      process.stdout.write(`\r\x1b[K${line.slice(0, process.stdout.columns || 120)}`);
    });
    process.stdout.write(`\r\x1b[K`);

    console.log(colors.green(`  ✔ ${context.totalScanned} files read, ${context.totalSkipped} skipped`));
    console.log(colors.dim(`    Languages: ${context.stack.languages.join(", ")}`));
    console.log(colors.dim(`    Frameworks: ${context.stack.frameworks.join(", ") || "none"}`));
    console.log(colors.dim(`    Docs: ${context.docs.length} files | References: ${context.references.length} files | Source: ${context.sourceFiles.length} files`));

    if (context.identity) {
      const preview = context.identity.split("\n").slice(0, 3).join(" ").slice(0, 200);
      console.log(colors.dim(`    Identity: ${preview}...`));
    }

    // 2. Research current best practices (only if frameworks detected — skip for pure languages)
    let research;
    if (context.stack.frameworks.length > 0) {
      const resSpin = spinner(
        `Researching best practices for ${context.stack.frameworks.join(", ")}...`
      );
      try {
        research = await researchStack(context.stack, repoName);
        resSpin.succeed(`Found ${research.length} research topic(s)`);
      } catch {
        resSpin.fail("Research failed (continuing without web context)");
        research = undefined;
      }
    }

    // 3. MCP discovery
    const mcpSpin = spinner("Discovering MCP servers...");
    try {
      const mcps = await discoverMcps(context.stack);
      allMcps.push(...mcps);
      mcpSpin.succeed(`Found ${mcps.length} relevant MCP server(s)`);
    } catch {
      mcpSpin.fail("MCP discovery failed (continuing)");
    }

    // 4. Load extra context files
    let extraContext = "";
    if (opts.contextFiles?.length) {
      const { readFile } = await import("node:fs/promises");
      for (const cf of opts.contextFiles) {
        try {
          const content = await readFile(cf, "utf-8");
          const name = cf.split("/").pop() || cf;
          extraContext += `\n\n## Extra Context: ${name}\n${content.slice(0, 10000)}\n`;
          console.log(colors.dim(`  + Loaded context: ${name} (${content.length} chars)`));
        } catch {
          console.log(colors.dim(`  ⚠ Could not read: ${cf}`));
        }
      }
    }

    // 5. Generate skills from deep context
    const genSpin = spinner(`Generating skills for ${repoName}...`);
    const projectSummary = buildProjectSummary(context) + extraContext;
    const generated = await generateSkillsFromContext(projectSummary, context.stack, skillsDir, repoName, research);
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
 * Build a comprehensive project summary from deep scan context.
 * This gets fed to Claude for skill generation.
 */
function buildProjectSummary(ctx: ProjectContext): string {
  const parts: string[] = [];

  // Identity
  parts.push(`# Project: ${ctx.name}\n\n${ctx.identity}`);

  // Structure overview
  parts.push(`\n## Structure\n${ctx.structure.slice(0, 100).join("\n")}`);

  // Stack
  parts.push(`\n## Stack\nLanguages: ${ctx.stack.languages.join(", ")}\nFrameworks: ${ctx.stack.frameworks.join(", ")}\nBuild: ${ctx.stack.buildTools.join(", ")}\nTesting: ${ctx.stack.testing.join(", ")}`);

  // Key docs (prioritize README and top-level docs)
  if (ctx.docs.length > 0) {
    parts.push(`\n## Documentation\n`);
    // Sort: READMEs first, then by path depth (shallower = more important)
    const sortedDocs = [...ctx.docs].sort((a, b) => {
      const aReadme = /readme/i.test(a.path) ? 0 : 1;
      const bReadme = /readme/i.test(b.path) ? 0 : 1;
      if (aReadme !== bReadme) return aReadme - bReadme;
      return a.path.split("/").length - b.path.split("/").length;
    });
    for (const doc of sortedDocs.slice(0, 10)) {
      const content = doc.content.slice(0, 2000);
      parts.push(`### ${doc.path}\n${content}\n`);
    }
  }

  // Reference materials — just list paths + first few lines as overview
  if (ctx.references.length > 0) {
    parts.push(`\n## Reference Materials (${ctx.references.length} files)\n`);
    // List all reference paths for awareness
    parts.push(ctx.references.slice(0, 50).map(r => `- ${r.path} (${r.language}, ${r.lines} lines)`).join("\n"));
    // Include content of only the most important ones (READMEs)
    const refReadmes = ctx.references.filter(r => /readme/i.test(r.path));
    for (const ref of refReadmes.slice(0, 3)) {
      parts.push(`\n### ${ref.path}\n${ref.content.slice(0, 1000)}\n`);
    }
  }

  // Manifests (only top-level ones)
  const topManifests = ctx.manifests.filter(m => m.path.split("/").length <= 2);
  for (const m of topManifests.slice(0, 5)) {
    parts.push(`\n## ${m.path}\n\`\`\`${m.language}\n${m.content.slice(0, 2000)}\n\`\`\``);
  }

  // Source code samples (diverse selection)
  const sampleBudget = 25;
  const categories = new Map<string, typeof ctx.sourceFiles>();
  for (const f of ctx.sourceFiles) {
    const dir = f.path.split("/").slice(0, 2).join("/");
    if (!categories.has(dir)) categories.set(dir, []);
    categories.get(dir)!.push(f);
  }

  parts.push(`\n## Source Code Samples\n`);
  let samplesIncluded = 0;
  for (const [dir, files] of categories) {
    if (samplesIncluded >= sampleBudget) break;
    // Pick up to 3 files per directory
    for (const f of files.slice(0, 2)) {
      if (samplesIncluded >= sampleBudget) break;
      const content = f.content.slice(0, 1000);
      parts.push(`### ${f.path} (${f.language}, ${f.lines} lines)\n\`\`\`${f.language}\n${content}\n\`\`\`\n`);
      samplesIncluded++;
    }
  }

  return parts.join("\n");
}

/**
 * Generate skills using deep project context + Claude CLI
 */
async function generateSkillsFromContext(
  projectSummary: string,
  stack: ProjectContext["stack"],
  outputDir: string,
  repoName: string,
  research?: any[],
): Promise<GeneratedSkill[]> {
  const { execSync } = await import("node:child_process");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join: joinPath } = await import("node:path");

  // Single Claude call: analyze project AND generate all skills at once
  // Keep context under 15K to avoid Claude CLI timeouts
  const prompt = `You are analyzing a software project and generating Claude Code skill files.

PROJECT CONTEXT:
${projectSummary.slice(0, 15000)}

${research?.length ? `\nWeb research on current best practices:\n${research.map(r => `${r.topic}: ${r.findings}`).join("\n\n").slice(0, 10000)}` : ""}

TASK: Generate exactly 4 SKILL.md files specific to THIS project "${repoName}":
1. Core domain — what this project does, key concepts
2. Architecture — codebase organization, data flow
3. Coding conventions — naming, idioms, patterns
4. Security — domain-specific security concerns

OUTPUT FORMAT: Return a JSON array of 4 objects:
- "name": kebab-case (e.g. "zcash-privacy-patterns")
- "category": "domain" | "architecture" | "conventions" | "security"
- "description": one-line
- "content": SKILL.md markdown (50-80 lines max)

Content sections: ## Description, ## Patterns, ## Conventions, ## Anti-Patterns
Be SPECIFIC to this project. Reference actual file paths.
Return ONLY the JSON array. No markdown fences.`;

  let skills: Array<{ name: string; category: string; description: string; content: string }>;
  try {
    const { spawn } = await import("node:child_process");
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn("claude", ["-p", prompt, "--output-format", "text"], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let lastLine = "";
      const timeout = setTimeout(() => { child.kill(); reject(new Error("Timeout")); }, 300000);

      child.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        // Show live preview of what Claude is generating
        const lines = text.split("\n").filter((l: string) => l.trim());
        if (lines.length > 0) {
          lastLine = lines[lines.length - 1].trim().slice(0, 80);
          process.stdout.write(`\r\x1b[K  ${colors.dim("⟩")} ${colors.dim(lastLine)}`);
        }
      });

      child.stderr.on("data", () => {}); // ignore stderr

      child.on("close", (code) => {
        clearTimeout(timeout);
        process.stdout.write(`\r\x1b[K`); // clear the preview line
        if (code !== 0) return reject(new Error(`claude exited with code ${code}`));
        resolve(stdout);
      });

      child.on("error", (err) => { clearTimeout(timeout); reject(err); });
    });
    const match = output.match(/\[[\s\S]*\]/);
    skills = match ? JSON.parse(match[0]) : [];
  } catch (err: any) {
    console.error(colors.dim(`  ⚠ Skill generation failed: ${err.message?.slice(0, 200)}`));
    return [];
  }

  // Write skill files
  const results: GeneratedSkill[] = [];
  for (const skill of skills) {
    if (!skill.name || !skill.content) continue;
    const skillDir = joinPath(outputDir, skill.name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(joinPath(skillDir, "SKILL.md"), skill.content, "utf-8");
    await writeFile(joinPath(skillDir, "meta.json"), JSON.stringify({
      name: skill.name,
      description: skill.description,
      category: skill.category,
      sourceRepo: repoName,
      createdAt: new Date().toISOString(),
    }, null, 2), "utf-8");
    results.push({
      name: skill.name,
      path: joinPath(skillDir, "SKILL.md"),
      description: skill.description || "",
      category: skill.category || "",
    });
  }

  return results;
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
