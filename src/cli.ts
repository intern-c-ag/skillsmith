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
${colors.bold("Usage:")} vibe train .

  Scan current repo and generate Claude Code skills.
  If a ${colors.cyan("reference/")} directory exists, it's automatically
  included as secondary context (lightweight weighting).

${colors.bold("Quick start:")}
  ${colors.dim("cd ~/my-project")}
  ${colors.dim("vibe train .")}
  ${colors.dim("vibe")}            ${colors.dim("# set up project + launch Claude Code")}

${colors.bold("Other commands:")}
  ${colors.cyan("(default)")}              Set up project + launch Claude Code
  ${colors.cyan("init")}                   Set up project without launching
  ${colors.cyan("mcp")}                    Discover and install MCP servers
  ${colors.cyan("push")} [repo]            Push skill library to GitHub
  ${colors.cyan("list")}                   List trained skills
  ${colors.cyan("config")} [key] [val]     Get or set configuration

${colors.bold("Advanced options:")}
  --context <file>     Add extra context (markdown, session exports)
  --exclude <glob>     Exclude paths from scan (repeatable)
  --dry-run            Explain train plan without writing skills
  --force-retrain      Ignore cache and regenerate all train targets
  --no-reference       Skip auto-inclusion of reference/ directory
  --edit-scope         Re-open scope wizard to reconfigure training scope
  --force              Overwrite all existing files
  --new                Start fresh session (skip resume)
  --no-claude          Skip Claude Code install and launch
  -h, --help           Show this help
  -v, --version        Show version
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
        // Parse train args robustly so option values are NOT treated as repo paths
        const repoPaths: string[] = [];
        const contextFiles: string[] = [];
        const excludePatterns: string[] = [];
        const noReference = flags.has("--no-reference");

        for (let i = 1; i < args.length; i++) {
          const a = args[i];
          if (a === "--context" && args[i + 1]) {
            contextFiles.push(resolve(args[i + 1]));
            i++;
            continue;
          }
          if (a === "--exclude" && args[i + 1]) {
            excludePatterns.push(args[i + 1]);
            i++;
            continue;
          }
          if (a.startsWith("-")) continue;
          repoPaths.push(resolve(a));
        }

        if (repoPaths.length === 0) {
          console.error(`${colors.red("Error:")} Provide at least one repo path`);
          console.error(`  ${colors.dim("vibe train .")}`);
          process.exit(1);
        }

        await train(repoPaths, {
          contextFiles,
          excludePatterns,
          ai: true,
          dryRun: flags.has("--dry-run"),
          forceRetrain: flags.has("--force-retrain"),
          autoReference: !noReference,
          editScope: flags.has("--edit-scope"),
        });
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
