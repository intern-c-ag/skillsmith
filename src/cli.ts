#!/usr/bin/env node

import { resolve } from "path";
import { banner, colors } from "./ui.js";

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith("-")));
const positional = args.filter(a => !a.startsWith("-"));
const command = positional[0];

function printHelp(): void {
  banner();
  console.log(`
${colors.bold("Usage:")} vibe [command] [options]

${colors.bold("Commands:")}
  ${colors.cyan("(default)")}              Set up project + launch Claude Code
  ${colors.cyan("train")} <path...>        Learn patterns from your repos
  ${colors.cyan("init")}                   Set up project without launching
  ${colors.cyan("mcp")}                    Discover and install MCP servers
  ${colors.cyan("push")} [repo]            Push skill library to GitHub
  ${colors.cyan("list")}                   List trained skills
  ${colors.cyan("config")} [key] [val]     Get or set configuration

${colors.bold("Options:")}
  --force              Overwrite all existing files
  --new                Start fresh session (skip resume)
  --no-claude          Skip Claude Code install and launch
  --context <file>     Add extra context (markdown, session exports)
  -h, --help           Show this help
  -v, --version        Show version

${colors.bold("Examples:")}
  ${colors.dim("# Set up and start vibing")}
  vibe

  ${colors.dim("# Train on your repos")}
  vibe train ~/projects/my-solana-app ~/projects/api

  ${colors.dim("# Train with extra context (e.g. Opencode session export)")}
  vibe train . --context ~/session-export.md --context ~/design-doc.md

  ${colors.dim("# Then start a new project with your skills")}
  cd ~/new-project && vibe

  ${colors.dim("# Just discover MCPs for current project")}
  vibe mcp
`);
}

async function main(): Promise<void> {
  if (flags.has("-h") || flags.has("--help")) {
    printHelp();
    process.exit(0);
  }

  if (flags.has("-v") || flags.has("--version")) {
    console.log("vibe v0.1.0");
    process.exit(0);
  }

  // Dynamic imports to keep startup fast
  const { run, train, init, mcp, push, list, config } = await import("./commands.js");

  const opts = {
    force: flags.has("--force"),
    newSession: flags.has("--new"),
    noClaude: flags.has("--no-claude"),
  };

  try {
    switch (command) {
      case undefined:
      case "start": {
        // Default: full setup + launch
        await run(process.cwd(), opts);
        break;
      }
      case "train": {
        const paths = positional.slice(1);
        if (paths.length === 0) {
          console.error(`${colors.red("Error:")} Provide at least one repo path`);
          console.error(`  ${colors.dim("vibe train ~/my-project")}`);
          process.exit(1);
        }
        // Collect --context files
        const contextFiles: string[] = [];
        for (let i = 0; i < args.length; i++) {
          if (args[i] === "--context" && args[i + 1]) {
            contextFiles.push(resolve(args[i + 1]));
            i++; // skip next
          }
        }
        await train(paths.map(p => resolve(p)), { contextFiles });
        break;
      }
      case "init": {
        await init(process.cwd(), opts);
        break;
      }
      case "mcp": {
        await mcp(process.cwd());
        break;
      }
      case "push": {
        const remote = positional[1];
        await push(remote);
        break;
      }
      case "list": {
        list();
        break;
      }
      case "config": {
        config(positional[1], positional[2]);
        break;
      }
      default:
        console.error(`${colors.red("Unknown command:")} ${command}`);
        printHelp();
        process.exit(1);
    }
  } catch (err) {
    console.error(`\n${colors.red("Error:")} ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

main();
