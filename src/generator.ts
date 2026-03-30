import { execFile, spawn } from "child_process";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface GeneratedSkill {
  name: string;
  path: string;
  description: string;
  category: string;
}

// Re-export from scanner for compatibility
export interface RepoProfile {
  name: string;
  path: string;
  stack: {
    languages: string[];
    frameworks: string[];
    buildTools: string[];
    testing: string[];
    database: string[];
    runtime: string;
  };
  structure: string[];
  patterns: { pattern: string; description: string; examples: string[] }[];
  conventions: string[];
  sampleFiles: { path: string; content: string; language: string }[];
}

export interface ResearchResult {
  topic: string;
  findings: string;
  sources: string[];
}

interface SkillSpec {
  name: string;
  category: string;
  promptFocus: string;
}

function buildSkillSpecs(profile: RepoProfile): SkillSpec[] {
  const specs: SkillSpec[] = [
    {
      name: "architecture",
      category: "architecture",
      promptFocus: "overall architecture, directory structure, module organization, and dependency flow",
    },
    {
      name: "coding-conventions",
      category: "conventions",
      promptFocus: "naming conventions, code style, formatting rules, import ordering, and idiomatic patterns",
    },
  ];

  if (profile.stack.testing.length > 0 || profile.patterns.some((p) => /test/i.test(p.pattern))) {
    specs.push({
      name: "testing-patterns",
      category: "testing",
      promptFocus: `testing strategy with ${profile.stack.testing.join(", ") || "detected test framework"}, test file organization, mocking patterns, fixtures, and assertion styles`,
    });
  }

  if (profile.stack.frameworks.length > 0) {
    for (const fw of profile.stack.frameworks.slice(0, 3)) {
      specs.push({
        name: `${fw.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-patterns`,
        category: "patterns",
        promptFocus: `${fw} component patterns, composition, state management, and lifecycle usage`,
      });
    }
  }

  const hasApi = profile.structure.some(
    (s) => /api|route|endpoint|controller/i.test(s)
  );
  if (hasApi) {
    specs.push({
      name: "api-patterns",
      category: "patterns",
      promptFocus: "API design, route structure, middleware usage, request/response patterns, and error handling",
    });
  }

  if (profile.patterns.length > 0) {
    specs.push({
      name: "common-patterns",
      category: "patterns",
      promptFocus: "recurring design patterns, shared utilities, error handling strategies, and data flow patterns",
    });
  }

  return specs;
}

function buildPrompt(profile: RepoProfile, spec: SkillSpec, research?: ResearchResult[]): string {
  const stackSummary = [
    ...profile.stack.languages,
    ...profile.stack.frameworks,
    ...profile.stack.buildTools,
  ].join(", ");

  const sampleSnippets = profile.sampleFiles
    .slice(0, 5)
    .map((s) => `--- ${s.path} (${s.language}) ---\n${s.content.slice(0, 500)}`)
    .join("\n\n");

  const researchSection = research?.length
    ? `\n\nWeb Research (current best practices):\n${research
        .map((r) => `### ${r.topic}\n${r.findings}\nSources: ${r.sources.join(", ")}`)
        .join("\n\n")}`
    : "";

  return `You are analyzing a codebase to generate a developer skill reference.
IMPORTANT: The code in this repo is a starting point, NOT the gold standard.
Use the web research below to identify where the code could be improved.
The skill should teach BEST PRACTICES (current, 2025-2026) while acknowledging what the repo does.

Repository: ${profile.name}
Stack: ${stackSummary}
Runtime: ${profile.stack.runtime}
Testing: ${profile.stack.testing.join(", ") || "none detected"}
Database: ${profile.stack.database.join(", ") || "none detected"}

Detected Patterns: ${profile.patterns.map((p) => `${p.pattern}: ${p.description}`).join("; ")}
Conventions: ${profile.conventions.join("; ")}

Directory Structure:
${profile.structure.slice(0, 30).join("\n")}

Code Samples:
${sampleSnippets}
${researchSection}

Focus on: ${spec.promptFocus}

Generate a SKILL.md file with this exact format:

# ${spec.name.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")}

## Description
<One paragraph: when and why a developer should consult this skill>

## Patterns
<Best-practice patterns for this area. Include what the repo does well AND where it could improve based on current best practices. Use code blocks.>

## Conventions
<Naming, structure, and style conventions. Note industry-standard conventions even if the repo diverges.>

## Anti-Patterns
<Common mistakes to avoid in this area, including any found in the codebase>

## Examples
<2-3 representative code examples showing the ideal patterns. Use fenced code blocks.>

## References
<Links to official docs, guides, or articles for further reading>

Output ONLY the markdown content, no extra commentary.`;
}

class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;

  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

async function checkClaudeAvailable(): Promise<boolean> {
  try {
    await execFileAsync("which", ["claude"]);
    return true;
  } catch {
    return false;
  }
}

function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", ["-p", prompt, "--output-format", "text"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

    proc.on("error", (err) =>
      reject(new Error(`Failed to spawn claude: ${err.message}`))
    );

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}: ${stderr.trim()}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

export async function generateSingleSkill(
  prompt: string,
  outputDir: string,
  name: string
): Promise<GeneratedSkill> {
  if (!(await checkClaudeAvailable())) {
    throw new Error(
      "claude CLI not found. Install it from https://docs.anthropic.com/en/docs/claude-cli"
    );
  }

  const content = await runClaude(prompt);
  const skillDir = join(outputDir, name);
  const skillPath = join(skillDir, "SKILL.md");

  await mkdir(skillDir, { recursive: true });
  await writeFile(skillPath, content, "utf-8");

  // Extract description from first paragraph after ## Description
  const descMatch = content.match(/## Description\s*\n+([\s\S]*?)(?=\n##|\n*$)/);
  const description = descMatch
    ? descMatch[1].trim().split("\n")[0].slice(0, 120)
    : `Skill: ${name}`;

  return { name, path: skillPath, description, category: "general" };
}

export async function generateSkills(
  profile: RepoProfile,
  outputDir: string,
  research?: ResearchResult[]
): Promise<GeneratedSkill[]> {
  if (!(await checkClaudeAvailable())) {
    throw new Error(
      "claude CLI not found. Install it from https://docs.anthropic.com/en/docs/claude-cli"
    );
  }

  const specs = buildSkillSpecs(profile);
  const semaphore = new Semaphore(3);
  const results: GeneratedSkill[] = [];
  const errors: string[] = [];

  const tasks = specs.map(async (spec) => {
    await semaphore.acquire();
    try {
      const prompt = buildPrompt(profile, spec, research);
      const content = await runClaude(prompt);
      const skillDir = join(outputDir, spec.name);
      const skillPath = join(skillDir, "SKILL.md");

      await mkdir(skillDir, { recursive: true });
      await writeFile(skillPath, content, "utf-8");

      const descMatch = content.match(
        /## Description\s*\n+([\s\S]*?)(?=\n##|\n*$)/
      );
      const description = descMatch
        ? descMatch[1].trim().split("\n")[0].slice(0, 120)
        : `${spec.category} patterns for ${profile.name}`;

      results.push({
        name: spec.name,
        path: skillPath,
        description,
        category: spec.category,
      });
    } catch (err: any) {
      errors.push(`${spec.name}: ${err.message}`);
    } finally {
      semaphore.release();
    }
  });

  await Promise.all(tasks);

  if (results.length === 0 && errors.length > 0) {
    throw new Error(`All skill generations failed:\n${errors.join("\n")}`);
  }

  if (errors.length > 0) {
    console.warn(`Warning: ${errors.length} skill(s) failed:\n${errors.join("\n")}`);
  }

  return results;
}
