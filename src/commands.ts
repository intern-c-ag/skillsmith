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
 * Train: deep-learn from repos
 */
export async function train(paths: string[]): Promise<void> {
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
      const pct = stats.total > 0 ? Math.round((stats.scanned + stats.skipped) / stats.total * 100) : 0;
      const line = `  ${colors.dim(`[${pct}%]`)} ${colors.cyan("reading")} ${file}`;
      // Overwrite current line
      process.stdout.write(`\r\x1b[K${line.slice(0, process.stdout.columns || 120)}`);
    });
    // Clear the progress line
    process.stdout.write(`\r\x1b[K`);

    console.log(colors.green(`  ✔ ${context.totalScanned} files read, ${context.totalSkipped} skipped`));
    console.log(colors.dim(`    Languages: ${context.stack.languages.join(", ")}`));
    console.log(colors.dim(`    Frameworks: ${context.stack.frameworks.join(", ") || "none"}`));
    console.log(colors.dim(`    Docs: ${context.docs.length} files | References: ${context.references.length} files | Source: ${context.sourceFiles.length} files`));

    if (context.identity) {
      const preview = context.identity.split("\n").slice(0, 3).join(" ").slice(0, 200);
      console.log(colors.dim(`    Identity: ${preview}...`));
    }

    // 2. Research current best practices
    const resSpin = spinner(
      `Researching best practices for ${context.stack.frameworks.join(", ") || context.stack.languages.join(", ")}...`
    );
    let research;
    try {
      research = await researchStack(context.stack, repoName);
      resSpin.succeed(`Found ${research.length} research topic(s)`);
    } catch {
      resSpin.fail("Research failed (continuing without web context)");
      research = undefined;
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

    // 4. Generate skills from deep context
    //    Build a comprehensive project summary for Claude
    const genSpin = spinner(`Generating skills for ${repoName}...`);
    const projectSummary = buildProjectSummary(context);
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

  // Key docs (full content of markdown files — these are gold)
  if (ctx.docs.length > 0) {
    parts.push(`\n## Documentation\n`);
    for (const doc of ctx.docs.slice(0, 20)) {
      // Include full content for docs up to 5000 chars each
      const content = doc.content.slice(0, 5000);
      parts.push(`### ${doc.path}\n${content}\n`);
    }
  }

  // Reference materials (full content — these teach context)
  if (ctx.references.length > 0) {
    parts.push(`\n## Reference Materials\n`);
    for (const ref of ctx.references.slice(0, 30)) {
      const content = ref.content.slice(0, 3000);
      parts.push(`### ${ref.path} (${ref.language})\n${content}\n`);
    }
  }

  // Manifests
  for (const m of ctx.manifests) {
    parts.push(`\n## ${m.path}\n\`\`\`${m.language}\n${m.content.slice(0, 3000)}\n\`\`\``);
  }

  // Source code samples (diverse selection)
  const sampleBudget = 50;
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
    for (const f of files.slice(0, 3)) {
      if (samplesIncluded >= sampleBudget) break;
      const content = f.content.slice(0, 2000);
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

  // First ask Claude to analyze the project and decide what skills to generate
  const planPrompt = `You are analyzing a software project to decide what skills to generate.

${projectSummary.slice(0, 50000)}

${research?.length ? `\nWeb research on current best practices:\n${research.map(r => `${r.topic}: ${r.findings}`).join("\n\n")}` : ""}

Based on this project, decide what skill files to generate. Each skill should be specific to THIS project's domain and patterns, not generic.

For a project like this, generate skills for:
1. The project's core domain (what it does, key concepts)
2. Architecture patterns used in this specific codebase
3. Coding conventions and idioms specific to this project
4. Testing patterns relevant to this stack
5. Security considerations specific to the domain
6. Any framework-specific patterns detected

Return ONLY a JSON array of objects with: name (kebab-case), category, description (one line).
Example: [{"name": "zcash-privacy-patterns", "category": "domain", "description": "Zcash shielded transaction patterns and privacy primitives"}]
No markdown fences, just JSON.`;

  let skillSpecs: Array<{ name: string; category: string; description: string }>;
  try {
    const planOutput = execSync(
      `claude -p ${JSON.stringify(planPrompt)} --output-format text`,
      { encoding: "utf-8", timeout: 60000, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024 }
    );
    const match = planOutput.match(/\[[\s\S]*\]/);
    skillSpecs = match ? JSON.parse(match[0]) : [];
  } catch {
    // Fallback: generate generic skills based on stack
    skillSpecs = [
      { name: "architecture", category: "architecture", description: `${repoName} architecture and patterns` },
      { name: "coding-conventions", category: "conventions", description: "Coding conventions and idioms" },
      { name: "domain-patterns", category: "domain", description: "Domain-specific patterns and concepts" },
    ];
  }

  // Generate each skill with full project context
  const results: GeneratedSkill[] = [];

  // Use a semaphore for parallel generation (max 3)
  const queue = [...skillSpecs];
  const running: Promise<void>[] = [];
  const MAX_CONCURRENT = 3;

  async function generateOne(spec: typeof skillSpecs[0]): Promise<void> {
    const prompt = `You are generating a SKILL.md file for a Claude Code skill called "${spec.name}" for the project "${repoName}".

Skill focus: ${spec.description}

PROJECT CONTEXT:
${projectSummary.slice(0, 40000)}

${research?.length ? `\nCurrent best practices from web research:\n${research.map(r => `${r.topic}: ${r.findings}`).join("\n\n").slice(0, 5000)}` : ""}

Generate a SKILL.md that is SPECIFIC to this project. Include:

## Description
When to use this skill (one paragraph, specific to ${repoName})

## Patterns
Concrete patterns from THIS codebase with code examples. Reference actual file paths and patterns you see.

## Conventions  
Naming, structure, and style conventions specific to this project.

## Anti-Patterns
What to avoid, based on both this codebase and current best practices.

## Key Concepts
Domain-specific concepts a developer needs to understand to work on this project.

## References
Links to relevant documentation, specs, or standards.

Be SPECIFIC. Reference actual code, actual file paths, actual patterns from the project. This is not a generic skill — it's a guide for THIS codebase.
Output ONLY the markdown. Max 200 lines.`;

    try {
      const output = execSync(
        `claude -p ${JSON.stringify(prompt)} --output-format text`,
        { encoding: "utf-8", timeout: 120000, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024 }
      );

      const skillDir = joinPath(outputDir, spec.name);
      await mkdir(skillDir, { recursive: true });
      await writeFile(joinPath(skillDir, "SKILL.md"), output, "utf-8");

      // Save metadata
      await writeFile(joinPath(skillDir, "meta.json"), JSON.stringify({
        name: spec.name,
        description: spec.description,
        category: spec.category,
        sourceRepo: repoName,
        createdAt: new Date().toISOString(),
      }, null, 2), "utf-8");

      results.push({
        name: spec.name,
        path: joinPath(skillDir, "SKILL.md"),
        description: spec.description,
        category: spec.category,
      });
    } catch (err: any) {
      console.error(colors.dim(`  ⚠ Failed to generate ${spec.name}: ${err.message?.slice(0, 100)}`));
    }
  }

  // Run with concurrency limit
  for (const spec of queue) {
    const p = generateOne(spec);
    running.push(p);
    if (running.length >= MAX_CONCURRENT) {
      await Promise.race(running);
      // Remove resolved promises
      for (let i = running.length - 1; i >= 0; i--) {
        const settled = await Promise.race([running[i].then(() => true), Promise.resolve(false)]);
        if (settled) running.splice(i, 1);
      }
    }
  }
  await Promise.all(running);

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
