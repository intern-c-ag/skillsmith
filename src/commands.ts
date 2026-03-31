import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { scanRepo } from "./scanner.js";
import { deepScan, type ProjectContext } from "./deep-scanner.js";
import { type GeneratedSkill } from "./generator.js";
import { generateSkillsFromLocalContext } from "./local-generator.js";
import { researchStack } from "./research.js";
import {
  computeContextFingerprint,
  computeRepoFingerprint,
  computeSkillSignatures,
  isCachedSkillsIndexUsable,
  loadTrainCache,
  saveTrainCache,
} from "./train-cache.js";
import { discoverMcps, installMcp, type McpServer } from "./mcp-discovery.js";
import {
  parseContextMarkdown,
  mergeContextSignals,
  formatSignalsForPrompt,
  logAppliedDirectives,
  isContextFilePath,
  type ParsedContextFile,
  type WeightedSignal,
} from "./context-parser.js";
import { setupProject } from "./setup.js";
import { isClaudeInstalled, installClaude, launchClaude } from "./claude-manager.js";
import { colors, spinner, banner, ask, confirm, table, progressBar } from "./ui.js";
import { getSkillsDir, listSkills, getConfig, setConfig } from "./store.js";
import {
  loadScopeConfig,
  runScopeWizard,
  scopeToWeights,
  scopeToExcludePatterns,
} from "./scope-wizard.js";
import {
  type Provider,
  resolveProvider,
  saveProjectProvider,
  isInteractive,
  isValidProvider,
} from "./provider.js";

interface RunOptions {
  force?: boolean;
  newSession?: boolean;
  noClaude?: boolean;
  /** CLI --provider flag value (unvalidated). */
  provider?: string;
}

/**
 * Default command: full setup + launch
 */
export async function run(projectDir: string, opts: RunOptions = {}): Promise<void> {
  banner();

  // 0. Resolve provider — prompt once if interactive and no prior choice
  const provider = await pickProvider(projectDir, opts.provider);

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

  // 4. Install & launch the selected provider
  if (!opts.noClaude) {
    await installAndLaunch(provider, projectDir, opts);
  } else {
    const cmd = provider === "opencode" ? "opencode" : "claude";
    console.log(`\n${colors.green("✔")} Project set up. Run ${colors.cyan(cmd)} to start.`);
  }
}

/**
 * Prompt the user (once) for provider choice if not already determined.
 * Saves the selection per-project.
 */
async function pickProvider(projectDir: string, flagOverride?: string): Promise<Provider> {
  // If flag provided or already saved, resolveProvider handles it
  const resolved = resolveProvider(projectDir, flagOverride);

  // If there was a flag or a saved choice, just use it
  if (flagOverride || resolved !== "claude" || !isInteractive()) {
    // resolved is authoritative when flag is set or a local/global config exists
    // For non-interactive with no saved config, default is "claude"
    return resolved;
  }

  // Check if there's an explicit saved choice (not just the fallback default)
  const hasLocalChoice = (() => {
    try {
      const { readFileSync } = require("node:fs");
      const data = JSON.parse(readFileSync(join(projectDir, ".vibe", "provider.json"), "utf-8"));
      return isValidProvider(data.provider);
    } catch { return false; }
  })();

  if (hasLocalChoice) return resolved;

  // Interactive prompt — ask once
  console.log(`\n${colors.bold("Provider selection:")}`);
  console.log(`  ${colors.cyan("[1]")} Claude Code`);
  console.log(`  ${colors.cyan("[2]")} Opencode\n`);

  const answer = await ask("Set up for Claude Code or Opencode? [1/2]: ");
  const choice: Provider = answer.trim() === "2" || answer.trim().toLowerCase() === "opencode"
    ? "opencode"
    : "claude";

  saveProjectProvider(projectDir, choice);
  console.log(colors.dim(`  Saved provider "${choice}" → .vibe/provider.json\n`));
  return choice;
}

/**
 * Install (if needed) and launch the selected provider.
 */
async function installAndLaunch(provider: Provider, projectDir: string, opts: RunOptions): Promise<void> {
  if (provider === "opencode") {
    // Check for opencode binary
    const { commandExists } = await import("./claude-manager.js");
    if (!commandExists("opencode")) {
      console.log(colors.yellow("\n⚠ opencode is not installed."));
      console.log(colors.dim("  Install: https://opencode.ai or npm i -g opencode"));
      return;
    }
    console.log(`\n${colors.green("✔")} Ready. Launching Opencode...\n`);
    const { spawn } = await import("node:child_process");
    const child = spawn("opencode", [], { cwd: projectDir, stdio: "inherit" });
    child.on("error", (err) => { console.error(`Failed to launch opencode: ${err.message}`); process.exit(1); });
    child.on("exit", (code) => { process.exit(code ?? 0); });
  } else {
    // Claude Code (existing behaviour)
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
    console.log(`\n${colors.green("✔")} Ready. Launching Claude Code...\n`);
    launchClaude(projectDir, { newSession: opts.newSession });
  }
}

/**
 * Init: setup without launching
 */
export async function init(projectDir: string, opts: RunOptions = {}): Promise<void> {
  // Don't re-print banner — run() does it
  await run(projectDir, { ...opts, noClaude: true });
}

interface TrainOptions {
  contextFiles?: string[];
  excludePatterns?: string[];
  ai?: boolean;
  dryRun?: boolean;
  forceRetrain?: boolean;
  /** Auto-include reference/ as secondary context (default true) */
  autoReference?: boolean;
  /** Re-open scope wizard even if config exists */
  editScope?: boolean;
}

/**
 * Train: deep-learn from repos
 */
export async function train(paths: string[], opts: TrainOptions = {}): Promise<void> {
  banner();
  const aiEnabled = opts.ai !== false;
  const cacheEnabled = !opts.forceRetrain;
  console.log(
    colors.dim(
      `Training mode: AI | cache: ${cacheEnabled ? "partial-reuse" : "disabled (--force-retrain)"}${opts.dryRun ? " | dry-run" : ""}`,
    ),
  );

  // Auto-include reference/ directories as secondary context (unless excluded)
  if (opts.autoReference !== false) {
    const refExcluded = (opts.excludePatterns ?? []).some((p) => p.includes("reference/**") || p.includes("reference/"));
    if (!refExcluded) {
      for (const p of paths) {
        const refDir = join(resolve(p), "reference");
        if (existsSync(refDir)) {
          console.log(colors.dim(`  using reference/ as secondary context`));
          break;
        }
      }
    }
  }

  const skillsDir = getSkillsDir();
  const allGenerated: GeneratedSkill[] = [];
  const allMcps: McpServer[] = [];
  let globalHits = 0;
  let globalMisses = 0;
  let totalReused = 0;
  let totalRegenerated = 0;

  // Defensive: ensure context files are never treated as repo paths
  const contextFileSet = new Set((opts.contextFiles ?? []).map((cf) => resolve(cf)));
  for (const p of paths) {
    const repoPath = resolve(p);
    if (contextFileSet.has(repoPath) || isContextFilePath(repoPath)) {
      console.log(colors.dim(`  ⚠ Skipping context file as repo path: ${p}`));
      continue;
    }
    const repoName = basename(repoPath);

    // ── Scope wizard ──────────────────────────────────────────────────
    const existingScope = loadScopeConfig(repoPath);
    let scopeConfig = existingScope;

    if (opts.editScope) {
      // --edit-scope: always re-open wizard
      scopeConfig = await runScopeWizard(repoPath, { editExisting: true });
    } else if (!existingScope) {
      // First run: prompt to configure scope
      scopeConfig = await runScopeWizard(repoPath);
    }

    // Apply scope to exclude patterns
    if (scopeConfig) {
      const weights = scopeToWeights(scopeConfig);
      const scopeExcludes = scopeToExcludePatterns(weights);
      // Merge scope excludes with any user-provided --exclude patterns
      const mergedExcludes = [...(opts.excludePatterns ?? [])];
      for (const se of scopeExcludes) {
        if (!mergedExcludes.includes(se)) mergedExcludes.push(se);
      }
      opts = { ...opts, excludePatterns: mergedExcludes };
      if (!existingScope) {
        console.log(colors.dim(`  scope: excluding ${weights.excludePaths.length} path(s), ${weights.referencePaths.length} reference path(s)`));
      }
    }

    const contextFingerprint = await computeContextFingerprint(opts.contextFiles ?? []);
    const cached = cacheEnabled ? loadTrainCache(repoPath) : null;
    const fp = await computeRepoFingerprint(repoPath);

    const globalHit =
      cacheEnabled &&
      Boolean(cached) &&
      cached?.fingerprint === fp.fingerprint &&
      cached?.contextFingerprint === contextFingerprint &&
      isCachedSkillsIndexUsable(cached.skills);

    if (globalHit) {
      globalHits++;
      console.log(colors.green(`\n🟢 Cache global hit: ${repoName}`));
      const reusedSkills = cached!.skills.map((s) => ({
        name: s.name,
        path: join(s.path, "SKILL.md"),
        description: s.description ?? "",
        category: s.category ?? "",
      }));
      allGenerated.push(...reusedSkills);
      totalReused += reusedSkills.length;
      console.log(colors.dim(`  per-skill: regenerated=0 reused=${reusedSkills.length}`));
      if (cached?.mcps?.length) {
        allMcps.push(
          ...cached.mcps.map((name) => ({
            name,
            description: "Cached MCP suggestion",
            installCmd: "",
          } as McpServer)),
        );
      }
      continue;
    }

    globalMisses++;
    console.log(colors.yellow(`\n🟡 Cache global miss: ${repoName}`));

    console.log(colors.bold(`\n📂 Scanning ${repoName}...\n`));
    const context = await deepScan(
      repoPath,
      (file, stats) => {
        const done = stats.scanned + stats.skipped;
        const bar = progressBar(done, stats.total);
        const truncFile = file.length > 50 ? "..." + file.slice(-47) : file;
        const line = `  ${bar}  ${colors.cyan(truncFile)}`;
        process.stdout.write(`\r\x1b[K${line.slice(0, process.stdout.columns || 120)}`);
      },
      { excludePatterns: opts.excludePatterns ?? [] },
    );
    process.stdout.write(`\r\x1b[K`);

    console.log(colors.green(`  ✔ ${context.totalScanned} files read, ${context.totalSkipped} skipped`));
    console.log(colors.dim(`  identity source: ${context.identitySource}`));

    let extraContext = "";
    const parsedContextFiles: ParsedContextFile[] = [];
    const allWeightedSignals: WeightedSignal[] = [];
    let aggregateFilterStats = { totalCandidates: 0, filteredNoisy: 0, retainedHigh: 0, retainedMedium: 0 };
    if (opts.contextFiles?.length) {
      const { readFile } = await import("node:fs/promises");
      for (const cf of opts.contextFiles) {
        try {
          const content = await readFile(cf, "utf-8");
          const name = cf.split("/").pop() || cf;
          const parsed = parseContextMarkdown(name, content);
          parsedContextFiles.push(parsed);
          allWeightedSignals.push(...parsed.weighted);
          aggregateFilterStats.totalCandidates += parsed.filterStats.totalCandidates;
          aggregateFilterStats.filteredNoisy += parsed.filterStats.filteredNoisy;
          aggregateFilterStats.retainedHigh += parsed.filterStats.retainedHigh;
          aggregateFilterStats.retainedMedium += parsed.filterStats.retainedMedium;

          // Build weighted context block: structured signals first, then raw excerpt
          const signalsBlock = formatSignalsForPrompt(parsed.signals, parsed.weighted);
          extraContext += signalsBlock ? `\n\n${signalsBlock}\n` : "";
          extraContext += `\n\n## Extra Context: ${name}\n${content.slice(0, 10000)}\n`;
          console.log(colors.dim(`  + Loaded context: ${name} (${parsed.kind}, ${parsed.weighted.length} weighted signals, ${content.length} chars)`));
        } catch {
          console.log(colors.dim(`  ⚠ Could not read: ${cf}`));
        }
      }

      // Log applied directives summary
      if (allWeightedSignals.length > 0) {
        logAppliedDirectives(allWeightedSignals, (msg) => console.log(colors.dim(msg)), aggregateFilterStats);
      }
    }

    let research;
    if (aiEnabled && context.stack.frameworks.length > 0) {
      const resSpin = spinner(`Researching best practices for ${context.stack.frameworks.join(", ")}...`);
      try {
        research = await researchStack(context.stack, repoName);
        resSpin.succeed(`Found ${research.length} research topic(s)`);
      } catch {
        resSpin.fail("Research failed (continuing without web context)");
      }
    }

    const mcpSpin = spinner("Discovering MCP servers...");
    let repoMcps: McpServer[] = [];
    try {
      repoMcps = await discoverMcps(context.stack, { enableAi: aiEnabled });
      allMcps.push(...repoMcps);
      mcpSpin.succeed(`Found ${repoMcps.length} relevant MCP server(s)`);
    } catch {
      mcpSpin.fail("MCP discovery failed (continuing)");
    }

    const plannedCategories = aiEnabled
      ? (["domain", "architecture", "conventions", "security"] as const)
      : (["domain", "architecture", "conventions", "security", "testing"] as const);

    const signalCount = allWeightedSignals.length || extractContextSignals(extraContext);
    const plannedSkills = plannedSkillsFor(repoName, context, aiEnabled);

    if (opts.dryRun) {
      printDryRunReport({
        repoName,
        context,
        contextFiles: opts.contextFiles ?? [],
        signalCount,
        aiEnabled,
        cacheDecision: globalHit ? "hit" : "miss",
        plannedSkills,
        mcpSuggestions: allMcps.map((m) => ({ name: m.name, reason: m.description })),
      });
      continue;
    }

    const currentSignatures = computeSkillSignatures(context, extraContext);
    const reusableByCategory = new Map<string, GeneratedSkill>();

    if (cacheEnabled && cached && isCachedSkillsIndexUsable(cached.skills) && cached.skillSignatures) {
      for (const category of plannedCategories) {
        const sigMatch = cached.skillSignatures[category] === currentSignatures[category];
        if (!sigMatch) continue;
        const entry = cached.skills.find((s) => s.category === category);
        if (!entry) continue;
        reusableByCategory.set(category, {
          name: entry.name,
          path: join(entry.path, "SKILL.md"),
          description: entry.description ?? "",
          category: entry.category ?? category,
        });
      }
    }

    const regenerateCategories = plannedCategories.filter((c) => !reusableByCategory.has(c));
    const regeneratedSkills: GeneratedSkill[] = [];

    if (regenerateCategories.length > 0) {
      const genSpin = spinner(`Generating ${regenerateCategories.length} changed skill(s) for ${repoName}...`);
      if (aiEnabled) {
        const projectSummary = buildProjectSummary(context) + extraContext;
        regeneratedSkills.push(
          ...(await generateSkillsFromContext(
            projectSummary,
            context.stack,
            skillsDir,
            repoName,
            research,
            [...regenerateCategories] as Array<"domain" | "architecture" | "conventions" | "security">,
          )),
        );
      } else {
        regeneratedSkills.push(
          ...(await generateSkillsFromLocalContext(context, skillsDir, repoName, allWeightedSignals.length ? allWeightedSignals : undefined, [...regenerateCategories])),
        );
      }
      genSpin.succeed(`Generated ${regeneratedSkills.length} skill(s)`);
    }

    const reusedSkills = [...reusableByCategory.values()];
    totalRegenerated += regeneratedSkills.length;
    totalReused += reusedSkills.length;

    console.log(colors.dim(`  per-skill: regenerated=${regeneratedSkills.length} reused=${reusedSkills.length}`));

    const combined = [...regeneratedSkills, ...reusedSkills];
    allGenerated.push(...combined);

    try {
      saveTrainCache(repoPath, {
        repoPath,
        repoName,
        fingerprint: fp.fingerprint,
        contextFingerprint,
        generatedAt: new Date().toISOString(),
        fileCount: fp.fileCount,
        skippedCount: fp.skippedCount,
        skills: combined.map((s) => ({
          name: s.name,
          description: s.description,
          category: s.category,
          path: join(skillsDir, s.name),
          sourceRepo: repoName,
        })),
        skillSignatures: Object.fromEntries(plannedCategories.map((c) => [c, currentSignatures[c]])),
        mcps: dedup(repoMcps).map((m) => m.name),
      });
    } catch {
      // cache write is best-effort
    }
  }

  if (opts.dryRun) {
    console.log(colors.green("\n✔ Dry-run complete. No skills were written."));
    return;
  }

  if (allGenerated.length === 0) {
    console.log(colors.yellow("No skills generated."));
    return;
  }

  console.log(colors.bold("\nCache summary:"));
  console.log(colors.dim(`  global hit/miss: ${globalHits}/${globalMisses}`));
  console.log(colors.dim(`  per-skill regenerated/reused: ${totalRegenerated}/${totalReused}`));

  console.log(colors.green(`\n✔ Generated/Reused ${allGenerated.length} skill(s):\n`));
  table([
    ["Name", "Description", "Category"],
    ...allGenerated.map((s) => [s.name, s.description ?? "", s.category ?? ""]),
  ]);

  if (allMcps.length > 0) {
    const unique = dedup(allMcps);
    await offerMcpInstall(unique);
  }

  console.log(colors.dim(`\nTip: run ${colors.cyan("vibe push")} to push skills to GitHub.`));
}
/**
 * Build a comprehensive project summary from deep scan context.
 * This gets fed to Claude for skill generation.
 */
function buildProjectSummary(ctx: ProjectContext): string {
  const parts: string[] = [];

  // Identity (source: ctx.identitySource)
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
  categories: Array<"domain" | "architecture" | "conventions" | "security"> = ["domain", "architecture", "conventions", "security"],
): Promise<GeneratedSkill[]> {
  const { spawn } = await import("node:child_process");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join: joinPath } = await import("node:path");

  const slug = repoName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "repo";
  const specs: Record<string, { description: string; focus: string }> = {
    domain: {
      description: `Core domain knowledge for ${repoName}`,
      focus: "what the project does, domain language, key concepts, workflows",
    },
    architecture: {
      description: `Architecture and codebase boundaries for ${repoName}`,
      focus: "module boundaries, data/control flow, layering, integration points",
    },
    conventions: {
      description: `Coding conventions and idioms for ${repoName}`,
      focus: "naming, organization, coding style, recurring patterns and anti-patterns",
    },
    security: {
      description: `Security guardrails for ${repoName}`,
      focus: "security-sensitive areas, validation, authz/authn, secrets handling",
    },
  };

  const out: GeneratedSkill[] = [];

  for (const category of categories) {
    const spec = specs[category];
    const skillName = `${slug}-${category}`;
    const prompt = `You are analyzing a software project and generating ONE Claude Code skill file.

PROJECT CONTEXT:
${projectSummary.slice(0, 15000)}

STACK:
Languages: ${stack.languages.join(", ")}
Frameworks: ${stack.frameworks.join(", ") || "none"}
Build tools: ${stack.buildTools.join(", ") || "none"}
Testing: ${stack.testing.join(", ") || "none"}

${research?.length ? `Web research on current best practices:\n${research.map(r => `${r.topic}: ${r.findings}`).join("\n\n").slice(0, 8000)}` : ""}

TASK:
- Generate exactly one SKILL.md for category: ${category}
- Focus on: ${spec.focus}
- Make it specific to this project and reference real file paths

OUTPUT FORMAT: Return ONLY markdown (no JSON, no fences around whole doc) with these sections:
# ${skillName}
## Description
## Patterns
## Conventions
## Anti-Patterns
## References

Keep it concise and practical.`;

    let content = "";
    try {
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn("claude", ["-p", prompt, "--output-format", "text"], {
          stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        const timeout = setTimeout(() => { child.kill(); reject(new Error("Timeout")); }, 300000);

        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", () => {});
        child.on("close", (code) => {
          clearTimeout(timeout);
          if (code !== 0) return reject(new Error(`claude exited with code ${code}`));
          resolve(stdout);
        });
        child.on("error", (err) => { clearTimeout(timeout); reject(err); });
      });
      content = output.trim();
    } catch (err: any) {
      console.error(colors.dim(`  ⚠ Skill generation failed (${category}): ${err.message?.slice(0, 200)}`));
      continue;
    }

    if (!content) continue;
    const skillDir = joinPath(outputDir, skillName);
    await mkdir(skillDir, { recursive: true });
    await writeFile(joinPath(skillDir, "SKILL.md"), `${content}\n`, "utf-8");
    await writeFile(joinPath(skillDir, "meta.json"), JSON.stringify({
      name: skillName,
      description: spec.description,
      category,
      sourceRepo: repoName,
      createdAt: new Date().toISOString(),
    }, null, 2), "utf-8");

    out.push({
      name: skillName,
      path: joinPath(skillDir, "SKILL.md"),
      description: spec.description,
      category,
    });
  }

  return out;
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

type DrySkillPlan = { name: string; reason: string };

function plannedSkillsFor(repoName: string, context: ProjectContext, aiEnabled: boolean): DrySkillPlan[] {
  const base = repoName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (aiEnabled) {
    return [
      { name: `${base}-domain-notes`, reason: "AI synthesis from docs + source" },
      { name: `${base}-architecture-notes`, reason: "AI infers boundaries from structure and manifests" },
      { name: `${base}-coding-conventions`, reason: "AI combines observed style with best practices" },
      { name: `${base}-security`, reason: "AI highlights security-sensitive paths and anti-patterns" },
    ];
  }
  return [
    { name: `${base}-domain`, reason: "Local scan of identity/docs" },
    { name: `${base}-architecture`, reason: "Local scan of structure/manifests" },
    { name: `${base}-conventions`, reason: "Local scan of source patterns" },
    { name: `${base}-security`, reason: "Local scan of sensitive areas" },
    { name: `${base}-testing`, reason: `Detected testing tools: ${context.stack.testing.join(", ") || "none"}` },
  ];
}

function extractContextSignals(contextBlock: string): number {
  if (!contextBlock.trim()) return 0;
  const matches = contextBlock.match(/\b(decision|convention|architecture|todo|workflow|pattern|security)\b/gi);
  return matches ? matches.length : 0;
}

function printDryRunReport(input: {
  repoName: string;
  context: ProjectContext;
  contextFiles: string[];
  signalCount: number;
  aiEnabled: boolean;
  cacheDecision: "hit" | "miss";
  plannedSkills: DrySkillPlan[];
  mcpSuggestions: Array<{ name: string; reason: string }>;
}): void {
  const topSkips = Object.entries(input.context.skipReasons || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} (${v})`)
    .join(", ");

  console.log(colors.bold(`\n🧪 Dry-run: ${input.repoName}`));
  console.log(colors.dim(`  cache: ${input.cacheDecision}`));
  console.log(colors.dim(`  files: scanned=${input.context.totalScanned}, skipped=${input.context.totalSkipped}${topSkips ? ` | top skip reasons: ${topSkips}` : ""}`));
  console.log(colors.dim(`  stack: languages=${input.context.stack.languages.join(", ") || "unknown"}; frameworks=${input.context.stack.frameworks.join(", ") || "none"}`));
  console.log(colors.dim(`  context: loaded=${input.contextFiles.length}, extracted signals≈${input.signalCount}`));
  console.log(colors.dim(`  mode: ${input.aiEnabled ? "AI enabled" : "local-first"}`));
  console.log(colors.dim("  planned skills:"));
  input.plannedSkills.forEach((s) => console.log(colors.dim(`    - ${s.name}: ${s.reason}`)));
  if (input.mcpSuggestions.length > 0) {
    console.log(colors.dim("  MCP suggestions:"));
    const seen = new Set<string>();
    for (const m of input.mcpSuggestions) {
      if (seen.has(m.name)) continue;
      seen.add(m.name);
      console.log(colors.dim(`    - ${m.name}: ${m.reason || "relevant to stack"}`));
    }
  } else {
    console.log(colors.dim("  MCP suggestions: none"));
  }
}

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
