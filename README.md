# skillsmith

Learn how you code. Generate Claude Code skills from your repos.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/intern-c-ag/skillsmith/master/install.sh | bash
```

## How it works

You point it at a repo. It scans your code, searches the web for current best practices, finds relevant MCP servers, and generates `.claude` skills that teach Claude how *you* build things — plus where you could do better.

```
skillsmith train ~/my-project
```

```
  ✔ Scanned my-project — Rust, TypeScript / Anchor, React
  ✔ Found 4 research topic(s)
  ✔ Found 3 relevant MCP server(s)
  ✔ Generated 6 skill(s)

  Name                 Description                          Category
  architecture         Project structure and module layout   architecture
  coding-conventions   Naming and style patterns            conventions
  anchor-patterns      Anchor program patterns              patterns
  react-patterns       React component patterns             patterns
  testing-patterns     Test strategy with Vitest            testing
  common-patterns      Shared utilities and error handling  patterns

  📡 Recommended MCP servers:

  [1] solana-mcp-server — Solana + Anchor documentation and examples
      claude mcp add --transport http solana-mcp-server https://mcp.solana.com/mcp
  [2] playwright — Browser automation for testing
      claude mcp add playwright -- npx -y @playwright/mcp@latest

  Install MCP servers? (comma-separated numbers, "all", or "skip"):
```

Then use those skills anywhere:

```bash
skillsmith init .          # copy skills into current project's .claude/
skillsmith push my-skills  # push your skill library to GitHub
skillsmith list            # see what you've trained
```

## What happens during `train`

1. **Scan** — reads your project structure and code samples. Skips secrets, build artifacts, deps, and anything sensitive (static rules + AI inference).
2. **Research** — uses Claude to search the web for current best practices for your stack. Your code isn't treated as gospel — skills capture what's ideal, not just what exists.
3. **MCP Discovery** — finds MCP servers relevant to your stack (Solana, Postgres, MongoDB, etc.) from a built-in registry + web search.
4. **Generate** — creates SKILL.md files enriched with both your patterns and web research. Includes anti-patterns and references.

## Requirements

- Node.js >= 18
- [Claude Code](https://docs.anthropic.com/claude-code) installed and logged in
- `gh` CLI (only for `push` command)

## Update

Run the install command again. It pulls the latest.

## Uninstall

```bash
rm -rf ~/.skillsmith ~/.local/bin/skillsmith ~/.config/skillsmith
```

## License

MIT
