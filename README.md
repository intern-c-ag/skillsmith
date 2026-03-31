# vibe

One command to set up your coding agent (Claude Code or Opencode) with skills, agents, and MCPs — learned from how you actually code.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/intern-c-ag/vibe/master/install.sh | bash
```

## Usage

```bash
cd ~/my-project
vibe
```

That's it. Vibe scans your project, generates a `.claude/` folder with agents, skills, commands, and config tailored to your stack, discovers and installs relevant MCP servers, installs Claude Code if needed, and launches it.

### Train on your repos

The real power: teach vibe how *you* code, then carry that everywhere.

```bash
# Learn from your existing projects
vibe train ~/projects/solana-app ~/projects/api-server

# Now every project gets your patterns
cd ~/new-project && vibe
```

Training is AI-first by default with cache protection: it scans your code (skips secrets), applies context directives, and uses Claude when needed. Cache hits skip unnecessary AI calls.

`vibe train` also uses partial cache reuse by default:

```bash
# 1) First run (no cache yet): full generation for every repo
vibe train ~/projects/app ~/projects/api

# 2) Run again with no changes: full cache hit (no regeneration)
vibe train ~/projects/app ~/projects/api

# 3) Change only one repo: partial regeneration (only changed repo regenerates)
vibe train ~/projects/app ~/projects/api
```

Use `--force-retrain` to bypass cache and regenerate everything.

You can also add extra context files (docs or Opencode/Claude markdown exports):

```bash
vibe train . \
  --context ~/exports/claude-session.md \
  --context ~/docs/roadmap.md
```

Session-style markdown exports are parsed for structured signals (decisions, conventions, architecture notes, security requirements, TODOs, tooling/workflow) with **confidence-weighted scoring**:

- **High confidence**: Explicit constraints ("only Solana+Zcash", "must use", "never do X"), security requirements, and heading-matched decisions are prioritized and injected as critical directives that override repo scan inferences.
- **Medium confidence**: Architectural decisions, coding conventions extracted from context.
- **Low confidence**: Vague or short items that provide background but don't drive skill generation.

This ensures context files from exported conversations (Claude Code, Opencode) strongly influence generated skills rather than being diluted by repo scan noise. A summary of applied directives is logged during training.

Plain markdown gracefully falls back to raw excerpt context.

### All commands

```
vibe                     Set up project + launch Claude Code
vibe train <path...>     Learn patterns from your repos (AI-first with cache reuse)
vibe init                Set up project without launching
vibe mcp                 Discover and install MCP servers
vibe push [repo]         Push skill library to GitHub
vibe list                List trained skills
vibe config [key] [val]  Get or set configuration
```

### Provider selection

On first interactive run, vibe asks which coding agent to use:

```
Set up for Claude Code or Opencode? [1/2]:
```

The choice is remembered per-project in `.vibe/provider.json` (with a global fallback in `~/.config/vibe/provider.json`). Override non-interactively:

```bash
vibe --provider claude     # use Claude Code
vibe --provider opencode   # use Opencode
```

If no selection exists and stdin is not a TTY, Claude Code is used by default.

### Flags

```
--provider <name>    Select provider: claude | opencode
--context <file>     Add extra context file (repeatable)
--force-retrain      Ignore cache and force skill regeneration (train only)
--force              Overwrite existing files
--new                Fresh session (skip resume)
--no-claude          Skip coding agent install/launch
```

## What gets generated

```
.claude/
├── agents/          Specialized sub-agents (research, commits, testing, review)
│                    + domain agents auto-detected (Solana, Zcash, Circom, mobile)
├── skills/          Auto-generated + trained skills for your stack
├── commands/        Slash commands (/commit, /review, /test, /fix)
├── config/          Project configuration
└── settings.json
```

Everything is generated dynamically based on your actual project — not from a static template.

### Domain Agents

When domain-specific signals are detected in your project stack, additional specialized agents are auto-generated:

| Domain | Agent | Triggered by |
|--------|-------|-------------|
| Solana | `solana-security-reviewer` | Anchor, SPL, Solana frameworks |
| Zcash | `zcash-wallet-specialist` | librustzcash, zebra, sapling/orchard |
| Circom/ZK | `zk-circom-engineer` | Circom, snarkjs, ZK proof tooling |
| Mobile Wallet | `mobile-wallet-performance` | React Native/Flutter + crypto signals |

Domain agents are preserved across re-runs unless `--force` is used.

## Identity Override (`vibe-identity.md`)

If your project's inferred identity drifts (e.g., vibe says "multi-chain" when you mean "Solana + Zcash only"), create a `vibe-identity.md` at the repo root. It takes **highest precedence** over README and manifest inference.

**Precedence order:**
1. `vibe-identity.md` (pinned identity — never overridden)
2. Context files (`IDENTITY.md`, `.vibe/identity.md`)
3. README / manifest inference
4. Fallback (project name)

**Example `vibe-identity.md`:**

```markdown
# MyWallet

A privacy-focused Solana + Zcash wallet for mobile.

- Chains: Solana, Zcash — no others.
- Target: iOS and Android via React Native.
- Tone: security-first, minimalist.
```

The log output will show `identity source: vibe-identity.md` so you can verify which source was used.

## Requirements

- Node.js >= 18
- [Claude Code](https://docs.anthropic.com/claude-code) (installed automatically if missing)
- `gh` CLI (only for `push`)

## Update

```bash
curl -fsSL https://raw.githubusercontent.com/intern-c-ag/vibe/master/install.sh | bash
```

## Claude Code Agent Compatibility

Generated agents include YAML frontmatter (`name` and `description` fields) so they appear in Claude Code's `/agents` list. The expected format is:

```markdown
---
name: agent-name
description: "When to use this agent"
---

# Agent Title

Agent instructions...
```

Agents are written to `.claude/agents/*.md` — the standard Claude Code project agents directory. If an agent file is missing frontmatter, `vibe setup` will log a warning.

### Generated Agents

| Agent | Description |
|-------|-------------|
| `research-web` | Research best practices online before implementing |
| `commit-manager` | Git workflow: conventional commits, PRs |
| `tester` | Create and maintain tests |
| `reviewer` | Code review for security, performance, quality |
| `project-historian` | Track decisions and architecture changes |
| *domain agents* | Auto-detected (Solana, Zcash, Circom, mobile-wallet) |

## Nested Scope Rules

The scope wizard tags top-level directories, but sometimes you need finer control. **Nested scope rules** let you override tags for specific sub-paths using glob patterns with **first-match-wins** semantics.

### How It Works

Rules are evaluated before top-level entries. The first matching glob determines the tag for a file path. If no rule matches, the top-level entry tag applies.

### Examples

```jsonc
// .vibe/scope.json
{
  "version": 2,
  "entries": [
    { "name": "modules", "tag": "core" },
    { "name": "node_modules", "tag": "deps/generated" }
  ],
  "rules": [
    { "glob": "modules/**/reference/**", "tag": "ignore" },
    { "glob": "modules/expo-tor-bridge/**", "tag": "core" }
  ]
}
```

With this config:
- `modules/foo/bar.ts` → **core** (top-level entry)
- `modules/foo/reference/spec.md` → **ignore** (rule 1 matches first)
- `modules/expo-tor-bridge/index.ts` → **core** (rule 2 matches first)

### Managing Rules

**During training:** The scope wizard offers an optional refinement step after top-level tagging, where you can add nested rules for core/reference folders.

**Standalone editor:**

```bash
vibe scope-rules          # edit rules for current directory
vibe scope-rules ./repo   # edit rules for a specific repo
```

The editor supports: `add`, `list`, `delete <n>`, `save`.

### Supported Tags

| Tag | Effect |
|-----|--------|
| `core` | Full weight in training scan |
| `reference` | Included but lower weight |
| `deps/generated` | Excluded from scan |
| `ignore` | Excluded from scan |

### Migration

Existing `version: 1` scope configs are automatically migrated to `version: 2` with an empty rules array. No action needed.

## Supply-Chain Protection

Protect your repo from dependency confusion and typosquatting attacks by enforcing a minimum release age on new packages.

```bash
vibe protect deps
```

Detects npm, pnpm, yarn, bun, and uv in the current directory, shows which are configured, and offers to write repo-local config (`.npmrc`, `.yarnrc.yml`, `pnpm-workspace.yaml`, `bunfig.toml`, `pyproject.toml`) with safe defaults. Never modifies global config. Appends only if the key is missing.

## Uninstall

```bash
rm -rf ~/.vibe ~/.local/bin/vibe ~/.config/vibe
```
