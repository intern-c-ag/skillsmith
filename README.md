# vibe

One command to set up Claude Code with skills, agents, and MCPs — learned from how you actually code.

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

Session-style markdown exports are parsed for structured signals (decisions, conventions, architecture notes, TODOs, tooling/workflow). Plain markdown gracefully falls back to raw excerpt context.

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

### Flags

```
--context <file>     Add extra context file (repeatable)
--force-retrain      Ignore cache and force skill regeneration (train only)
--force              Overwrite existing files
--new                Fresh session (skip resume)
--no-claude          Skip Claude Code install/launch
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

## Uninstall

```bash
rm -rf ~/.vibe ~/.local/bin/vibe ~/.config/vibe
```
