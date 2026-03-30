import { readFile, writeFile, mkdir, access, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';

// ── Types ──────────────────────────────────────────────────────────────────

export interface SetupResult {
  agents: number;
  skills: number;
  commands: number;
  hooks: number;
  config: number;
  mcpsInstalled: number;
  _stack: StackInfo;
}

export interface SetupOptions {
  force?: boolean;
  noClaude?: boolean;
  newSession?: boolean;
}

export interface StackInfo {
  languages: string[];
  frameworks: string[];
  buildTools: string[];
  testing: string[];
  database: string[];
  runtime: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function exists(p: string): Promise<boolean> {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}

async function readJson(p: string): Promise<any> {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; }
}

async function fileContains(p: string, needle: string): Promise<boolean> {
  try { return (await readFile(p, 'utf8')).includes(needle); } catch { return false; }
}

async function mkdirp(p: string) { await mkdir(p, { recursive: true }); }

async function writeIfAllowed(path: string, content: string, force: boolean, existingFiles: Set<string>) {
  if (!force && existingFiles.has(path)) return false;
  await mkdirp(join(path, '..'));
  await writeFile(path, content, 'utf8');
  return true;
}

function semaphore(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async function <T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>(r => queue.push(r));
    active++;
    try { return await fn(); } finally {
      active--;
      if (queue.length) queue.shift()!();
    }
  };
}

function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    try {
      execFile('claude', ['-p', prompt, '--output-format', 'text'], {
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
      }, (err, stdout) => {
        if (err || !stdout?.trim()) {
          resolve('<!-- Content generation unavailable. Fill in manually. -->');
        } else {
          resolve(stdout.trim());
        }
      });
    } catch {
      resolve('<!-- Content generation unavailable. Fill in manually. -->');
    }
  });
}

// ── Stack Detection ────────────────────────────────────────────────────────

async function detectStack(dir: string): Promise<StackInfo> {
  const info: StackInfo = {
    languages: [], frameworks: [], buildTools: [], testing: [], database: [], runtime: 'node',
  };

  const pkg = await readJson(join(dir, 'package.json'));
  const allDeps = pkg ? { ...pkg.dependencies, ...pkg.devDependencies } : {};
  const depKeys = Object.keys(allDeps);

  const checks: Array<[() => Promise<boolean>, () => void]> = [
    // Languages
    [() => exists(join(dir, 'tsconfig.json')), () => { info.languages.push('typescript'); info.languages.push('javascript'); }],
    [async () => !!pkg && !await exists(join(dir, 'tsconfig.json')), () => { if (!info.languages.includes('javascript')) info.languages.push('javascript'); }],
    [() => exists(join(dir, 'Cargo.toml')), () => { info.languages.push('rust'); info.runtime = 'rust'; }],
    [() => exists(join(dir, 'go.mod')), () => { info.languages.push('go'); info.runtime = 'go'; }],
    [() => exists(join(dir, 'pyproject.toml')), () => { info.languages.push('python'); info.runtime = 'python'; }],
    [async () => await exists(join(dir, 'setup.py')) || await exists(join(dir, 'requirements.txt')), () => { if (!info.languages.includes('python')) { info.languages.push('python'); info.runtime = 'python'; } }],
    [() => exists(join(dir, 'pubspec.yaml')), () => { info.languages.push('dart'); info.frameworks.push('flutter'); info.runtime = 'dart'; }],
    [() => exists(join(dir, 'Gemfile')), () => { info.languages.push('ruby'); info.runtime = 'ruby'; }],
    [() => exists(join(dir, 'build.gradle')), () => { info.languages.push('java'); info.runtime = 'jvm'; }],
    [() => exists(join(dir, 'pom.xml')), () => { if (!info.languages.includes('java')) { info.languages.push('java'); info.runtime = 'jvm'; } }],

    // Frameworks
    [async () => 'next' in allDeps || await exists(join(dir, 'next.config.js')) || await exists(join(dir, 'next.config.mjs')) || await exists(join(dir, 'next.config.ts')), () => info.frameworks.push('nextjs')],
    [async () => 'react' in allDeps, () => { if (!info.frameworks.includes('react')) info.frameworks.push('react'); }],
    [async () => 'vue' in allDeps, () => info.frameworks.push('vue')],
    [async () => 'svelte' in allDeps || 'svelte-kit' in allDeps || '@sveltejs/kit' in allDeps, () => info.frameworks.push('svelte')],
    [async () => 'express' in allDeps, () => info.frameworks.push('express')],
    [async () => 'fastify' in allDeps, () => info.frameworks.push('fastify')],
    [async () => 'hono' in allDeps, () => info.frameworks.push('hono')],
    [async () => '@nestjs/core' in allDeps, () => info.frameworks.push('nestjs')],
    [() => exists(join(dir, 'Anchor.toml')), () => { info.frameworks.push('anchor'); info.frameworks.push('solana'); }],
    [async () => {
      // Detect native Solana programs (no Anchor) — check Cargo.toml for solana deps
      if (info.frameworks.includes('solana')) return false;
      const cargoPath = join(dir, 'Cargo.toml');
      if (await exists(cargoPath)) {
        return await fileContains(cargoPath, 'solana-program') ||
               await fileContains(cargoPath, 'solana-sdk') ||
               await fileContains(cargoPath, 'anchor-lang') ||
               await fileContains(cargoPath, 'pinocchio');
      }
      // Check for package.json solana deps (JS/TS Solana projects)
      return '@solana/web3.js' in allDeps || '@solana/spl-token' in allDeps || '@coral-xyz/anchor' in allDeps;
    }, () => { if (!info.frameworks.includes('solana')) info.frameworks.push('solana'); }],
    [async () => await exists(join(dir, 'hardhat.config.js')) || await exists(join(dir, 'hardhat.config.ts')), () => info.frameworks.push('hardhat')],
    [async () => await exists(join(dir, 'foundry.toml')), () => info.frameworks.push('foundry')],
    [async () => 'django' in allDeps || await fileContains(join(dir, 'pyproject.toml'), 'django'), () => info.frameworks.push('django')],
    [async () => 'flask' in allDeps || await fileContains(join(dir, 'pyproject.toml'), 'flask'), () => info.frameworks.push('flask')],
    [async () => 'fastapi' in allDeps || await fileContains(join(dir, 'pyproject.toml'), 'fastapi'), () => info.frameworks.push('fastapi')],
    [async () => '@angular/core' in allDeps, () => info.frameworks.push('angular')],
    [async () => 'tailwindcss' in allDeps, () => info.frameworks.push('tailwind')],
    [async () => 'electron' in allDeps, () => info.frameworks.push('electron')],
    [async () => 'react-native' in allDeps, () => info.frameworks.push('react-native')],

    // Build tools
    [async () => 'vite' in allDeps, () => info.buildTools.push('vite')],
    [async () => 'webpack' in allDeps, () => info.buildTools.push('webpack')],
    [async () => 'esbuild' in allDeps || 'tsup' in allDeps, () => info.buildTools.push('esbuild')],
    [async () => 'turbo' in allDeps || await exists(join(dir, 'turbo.json')), () => info.buildTools.push('turborepo')],
    [async () => await exists(join(dir, 'nx.json')), () => info.buildTools.push('nx')],
    [async () => await exists(join(dir, 'Dockerfile')), () => info.buildTools.push('docker')],
    [async () => await exists(join(dir, 'docker-compose.yml')) || await exists(join(dir, 'docker-compose.yaml')) || await exists(join(dir, 'compose.yml')), () => info.buildTools.push('docker-compose')],
    [async () => await exists(join(dir, 'bun.lockb')) || await exists(join(dir, 'bun.lock')), () => { info.buildTools.push('bun'); info.runtime = 'bun'; }],
    [async () => await exists(join(dir, 'pnpm-lock.yaml')), () => info.buildTools.push('pnpm')],
    [async () => await exists(join(dir, 'yarn.lock')), () => info.buildTools.push('yarn')],
    [async () => await exists(join(dir, 'deno.json')) || await exists(join(dir, 'deno.jsonc')), () => { info.buildTools.push('deno'); info.runtime = 'deno'; }],

    // Testing
    [async () => 'vitest' in allDeps, () => info.testing.push('vitest')],
    [async () => 'jest' in allDeps, () => info.testing.push('jest')],
    [async () => 'mocha' in allDeps, () => info.testing.push('mocha')],
    [async () => '@playwright/test' in allDeps || 'playwright' in allDeps, () => info.testing.push('playwright')],
    [async () => 'cypress' in allDeps, () => info.testing.push('cypress')],
    [async () => await fileContains(join(dir, 'pyproject.toml'), 'pytest'), () => info.testing.push('pytest')],
    [async () => await fileContains(join(dir, 'Cargo.toml'), '[dev-dependencies]'), () => info.testing.push('cargo-test')],

    // Database
    [async () => 'prisma' in allDeps || '@prisma/client' in allDeps, () => info.database.push('prisma')],
    [async () => 'drizzle-orm' in allDeps, () => info.database.push('drizzle')],
    [async () => 'typeorm' in allDeps, () => info.database.push('typeorm')],
    [async () => 'mongoose' in allDeps, () => info.database.push('mongodb')],
    [async () => 'pg' in allDeps || '@neondatabase/serverless' in allDeps, () => info.database.push('postgres')],
    [async () => 'redis' in allDeps || 'ioredis' in allDeps, () => info.database.push('redis')],
    [async () => '@supabase/supabase-js' in allDeps, () => info.database.push('supabase')],
  ];

  await Promise.all(checks.map(async ([check, apply]) => { if (await check()) apply(); }));

  // Deduplicate
  for (const key of ['languages', 'frameworks', 'buildTools', 'testing', 'database'] as const) {
    info[key] = [...new Set(info[key])];
  }

  return info;
}

// ── Generators ─────────────────────────────────────────────────────────────

function generateAgentContent(name: string, stack: StackInfo): string {
  const testFramework = stack.testing[0] || 'the project\'s test framework';
  const langs = stack.languages.join(', ') || 'the project languages';

  const agents: Record<string, string> = {
    'research-web': `# Research Web Agent

## Role
Research best practices, patterns, and solutions online before implementing changes.

## Instructions
- Before writing code, search for current best practices (2025-2026) for ${langs}
- Look for official documentation, RFCs, and community consensus
- Compare multiple approaches and recommend the best fit for this project
- Cite sources when possible
- Focus on: ${stack.frameworks.join(', ') || 'general software development'}

## When to Use
- Before implementing a new feature or pattern
- When unsure about the best approach
- When upgrading dependencies or migrating APIs
- When implementing security-sensitive features
`,

    'commit-manager': `# Commit Manager Agent

## Role
Handle git commits with conventional commit format and meaningful PR descriptions.

## Instructions
- Use conventional commits: feat:, fix:, chore:, docs:, refactor:, test:, perf:, ci:
- Write clear, concise commit messages (max 72 chars subject)
- Group related changes into logical commits
- Generate PR descriptions with: summary, changes list, testing notes
- For ${langs} projects, mention affected modules/packages

## When to Use
- When committing changes
- When creating pull requests
- When squashing or organizing commits
`,

    'tester': `# Tester Agent

## Role
Create and maintain tests appropriate for this project's stack.

## Instructions
- Testing framework: ${testFramework}
- Languages: ${langs}
- Write unit tests for new functions and modules
- Write integration tests for API endpoints and workflows
- Ensure edge cases are covered: null inputs, empty arrays, error states
- Follow AAA pattern (Arrange, Act, Assert)
${stack.testing.includes('vitest') ? '- Use vitest conventions: describe/it/expect, vi.mock for mocking' : ''}
${stack.testing.includes('jest') ? '- Use jest conventions: describe/it/expect, jest.mock for mocking' : ''}
${stack.testing.includes('pytest') ? '- Use pytest fixtures, parametrize for data-driven tests' : ''}
${stack.testing.includes('cargo-test') ? '- Use #[test], #[cfg(test)] modules, assert! macros' : ''}
${stack.testing.includes('playwright') ? '- Write e2e tests with proper selectors and wait strategies' : ''}

## When to Use
- After implementing new features
- When fixing bugs (write regression test first)
- When refactoring (ensure tests pass before and after)
`,

    'reviewer': `# Code Reviewer Agent

## Role
Review code for quality, security, performance, and adherence to project patterns.

## Instructions
- Check for: security vulnerabilities, performance issues, code smells
- Verify error handling is comprehensive
- Ensure consistent naming and code style for ${langs}
- Look for: hardcoded secrets, SQL injection, XSS, missing input validation
- Check that new code follows existing patterns in the codebase
${stack.frameworks.includes('react') ? '- React: check for proper hook usage, memo where needed, key props' : ''}
${stack.frameworks.includes('nextjs') ? '- Next.js: verify server/client component boundaries, proper data fetching' : ''}
${stack.frameworks.includes('solana') || stack.frameworks.includes('anchor') ? '- Solana: check for missing signer checks, account validation, reentrancy' : ''}
- Suggest improvements, not just problems

## When to Use
- Before merging PRs
- After major refactors
- When reviewing external contributions
`,
  };

  return agents[name] || `# ${name}\n\nAgent file.\n`;
}

function generateCommandContent(name: string, stack: StackInfo): string {
  const commands: Record<string, string> = {
    'commit': `Analyze the current git diff and staged changes. Create a conventional commit with:
1. Appropriate type prefix (feat/fix/chore/docs/refactor/test/perf/ci)
2. Clear, concise subject line (max 72 chars)
3. Detailed body if the change is non-trivial
4. Reference any related issues

Run \`git diff --staged\` to see what's staged. If nothing is staged, show \`git diff\` and ask what to stage.
`,
    'review': `Review the current changes for quality, security, and best practices.

1. Run \`git diff\` to see uncommitted changes (or \`git diff main..HEAD\` for branch changes)
2. Check for: security issues, performance problems, code smells, missing error handling
3. Verify consistency with existing code patterns
4. Provide actionable feedback with specific line references
5. Rate overall quality: 🟢 Good / 🟡 Needs minor fixes / 🔴 Needs rework
`,
    'test': `Generate tests for the current changes or specified file.

1. Detect the test framework: ${stack.testing[0] || 'auto-detect from project config'}
2. Identify functions/components that need tests
3. Write comprehensive tests covering: happy path, edge cases, error cases
4. Place test files according to project convention
5. Run the tests to verify they pass
`,
    'fix': `Debug and fix the current issue.

1. Read any error messages or logs provided
2. Identify the root cause — don't just fix symptoms
3. Search the codebase for related patterns
4. Implement the fix with minimal changes
5. Verify the fix doesn't break existing tests
6. Explain what went wrong and why the fix works
`,
  };

  return commands[name] || `Describe what /${name} should do.\n`;
}

function getSkillsForStack(stack: StackInfo): Array<{ dir: string; topic: string }> {
  const skills: Array<{ dir: string; topic: string }> = [
    { dir: 'git-workflow', topic: 'Git workflow best practices: branching strategies, conventional commits, PR reviews, rebasing vs merging' },
    { dir: 'security-scan', topic: 'Security scanning and vulnerability detection: SAST, dependency auditing, secret scanning, OWASP top 10' },
    { dir: 'quality-gate', topic: 'Code quality gates: linting, formatting, type checking, pre-commit hooks, CI quality checks' },
    { dir: 'debugging-patterns', topic: 'Debugging patterns and techniques: systematic debugging, logging strategies, profiling, common pitfalls' },
  ];

  const { languages, frameworks } = stack;

  if (languages.includes('typescript')) skills.push({ dir: 'typescript-strict', topic: 'TypeScript strict mode best practices: strict config, type narrowing, discriminated unions, template literal types, satisfies operator' });
  if (frameworks.includes('react')) skills.push({ dir: 'react-patterns', topic: 'React patterns 2025-2026: server components, suspense, use() hook, React compiler, modern state management' });
  if (frameworks.includes('nextjs')) skills.push({ dir: 'nextjs-app-router', topic: 'Next.js App Router best practices 2025-2026: server actions, parallel routes, intercepting routes, caching strategies, ISR' });
  if (languages.includes('rust')) skills.push({ dir: 'rust-patterns', topic: 'Rust patterns: ownership, lifetimes, error handling with thiserror/anyhow, async patterns, trait design' });
  if (frameworks.includes('anchor') || frameworks.includes('solana')) {
    skills.push({ dir: 'anchor-patterns', topic: 'Anchor/Solana program patterns: account validation, PDA derivation, CPI, error handling, testing with bankrun' });
    skills.push({ dir: 'solana-security', topic: 'Solana security: signer checks, account validation, reentrancy, integer overflow, authority verification, Anchor constraints' });
  }
  if (languages.includes('python')) skills.push({ dir: 'python-patterns', topic: 'Python best practices 2025-2026: type hints, pydantic v2, async patterns, modern project structure, uv/ruff' });
  if (languages.includes('go')) skills.push({ dir: 'go-patterns', topic: 'Go patterns: error handling, context, generics, interfaces, testing, project layout' });
  if (stack.buildTools.includes('docker') || stack.buildTools.includes('docker-compose')) skills.push({ dir: 'docker-patterns', topic: 'Docker best practices: multi-stage builds, layer caching, security, compose patterns, healthchecks' });
  if (stack.testing.length > 0) skills.push({ dir: 'test-coverage', topic: `Test coverage strategies for ${stack.testing.join(', ')}: coverage thresholds, meaningful tests, mocking patterns, test organization` });
  if (frameworks.some(f => ['express', 'fastify', 'hono', 'nestjs', 'nextjs', 'fastapi', 'flask', 'django'].includes(f))) {
    skills.push({ dir: 'api-patterns', topic: 'API design patterns: REST conventions, error responses, pagination, versioning, validation, OpenAPI' });
  }

  return skills;
}

function generateSkillFallback(topic: string): string {
  return `# SKILL.md

## Description
${topic}

## When to Auto-Inject
When working on files related to this skill's domain.

## Patterns & Conventions
- Follow current best practices (2025-2026)
- See official documentation for the latest guidance

## Notes
This skill file was generated as a placeholder. Run \`claude -p\` to generate detailed content with web search for up-to-date practices.
`;
}

// ── Main ───────────────────────────────────────────────────────────────────

export async function setupProject(projectDir: string, options: SetupOptions = {}): Promise<SetupResult> {
  const { force = false, noClaude = false } = options;
  const claudeDir = join(projectDir, '.claude');
  const stack = await detectStack(projectDir);
  const result: SetupResult = { agents: 0, skills: 0, commands: 0, hooks: 0, config: 0, mcpsInstalled: 0, _stack: stack };

  // Collect existing files to preserve if not forcing
  const existingFiles = new Set<string>();
  if (!force && await exists(claudeDir)) {
    async function walk(dir: string) {
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          const p = join(dir, e.name);
          if (e.isDirectory()) await walk(p); else existingFiles.add(p);
        }
      } catch {}
    }
    await walk(claudeDir);
    // Always overwrite agents and settings even without force
    for (const f of existingFiles) {
      if (f.includes('/agents/') || basename(f) === 'settings.json') existingFiles.delete(f);
    }
  }

  // 1. Stack already detected above

  // Load pre-written templates (instant, no AI calls)
  let tpl: { agents: Record<string, string>; skills: Record<string, string>; commands: Record<string, string> } = { agents: {}, skills: {}, commands: {} };
  try {
    const { getTemplates } = await import('./templates.js');
    const t = getTemplates(stack);
    tpl = t;
  } catch {
    // templates module not available, fall back to inline generation
  }

  // 2. Generate agents
  const agentNames = ['research-web', 'commit-manager', 'tester', 'reviewer'];
  const agentsDir = join(claudeDir, 'agents');
  await mkdirp(agentsDir);
  for (const name of agentNames) {
    const content = tpl.agents[name] || generateAgentContent(name, stack);
    await writeFile(join(agentsDir, `${name}.md`), content, 'utf8');
    result.agents++;
  }

  const skillDefs = getSkillsForStack(stack);
  let skillCount = 0;
  for (const { dir, topic } of skillDefs) {
    const skillDir = join(claudeDir, 'skills', dir);
    const skillPath = join(skillDir, 'SKILL.md');
    if (!force && existingFiles.has(skillPath)) continue;
    await mkdirp(skillDir);

    // Use pre-written template if available, otherwise fallback
    const content = tpl.skills[dir] || generateSkillFallback(topic);
    await writeFile(skillPath, content, 'utf8');
    skillCount++;
  }
  result.skills = skillCount;

  // 4. Generate commands
  const commandNames = ['commit', 'review', 'test', 'fix'];
  const commandsDir = join(claudeDir, 'commands');
  await mkdirp(commandsDir);
  for (const name of commandNames) {
    const p = join(commandsDir, `${name}.md`);
    if (await writeIfAllowed(p, generateCommandContent(name, stack), force, existingFiles)) {
      result.commands++;
    }
  }

  // 5. Hooks (placeholder dir)
  const hooksDir = join(claudeDir, 'hooks');
  await mkdirp(hooksDir);

  // 6. Config
  const configDir = join(claudeDir, 'config');
  await mkdirp(configDir);
  const configPath = join(configDir, 'project-config.json');
  if (await writeIfAllowed(configPath, JSON.stringify({ stack, generatedAt: new Date().toISOString(), version: '1.0.0' }, null, 2) + '\n', force, existingFiles)) {
    result.config++;
  }

  // 7. Settings
  const settingsPath = join(claudeDir, 'settings.json');
  const settings: Record<string, any> = {
    permissions: {
      allow: [
        'Read(**)',
        'Edit(**)',
        'Write(**)',
        'Bash(git *)',
        ...(stack.testing.length ? [`Bash(${stack.testing.includes('vitest') ? 'npx vitest' : stack.testing.includes('jest') ? 'npx jest' : stack.testing.includes('pytest') ? 'pytest' : stack.testing.includes('cargo-test') ? 'cargo test' : 'npm test'} *)`] : []),
        ...(stack.buildTools.includes('docker') ? ['Bash(docker build *)', 'Bash(docker compose *)'] : []),
      ],
      deny: [
        'Bash(rm -rf /)',
        'Bash(sudo *)',
      ],
    },
  };
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  result.config++;

  return result;
}
