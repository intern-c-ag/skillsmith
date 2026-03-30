import { execSync } from "child_process";

export interface McpServer {
  name: string;
  description: string;
  installCmd: string;
  source: string;
  category: string;
}

export interface StackInfo {
  languages: string[];
  frameworks: string[];
  buildTools: string[];
  testing: string[];
  database: string[];
  runtime: string;
}

const BUILT_IN_REGISTRY: McpServer[] = [
  {
    name: "solana-mcp-server",
    description: "Solana blockchain integration — deploy, interact with programs, manage wallets",
    installCmd: "claude mcp add --transport http solana-mcp-server https://mcp.solana.com/mcp",
    source: "built-in",
    category: "blockchain",
  },
  {
    name: "playwright",
    description: "Browser automation and testing with Playwright",
    installCmd: "claude mcp add playwright -- npx -y @playwright/mcp@latest",
    source: "built-in",
    category: "testing",
  },
  {
    name: "postgres",
    description: "PostgreSQL database exploration and querying",
    installCmd: "claude mcp add postgres -- npx -y @modelcontextprotocol/server-postgres",
    source: "built-in",
    category: "database",
  },
  {
    name: "mongodb",
    description: "MongoDB database operations and querying",
    installCmd: "claude mcp add mongodb -- npx -y @mongodb-js/mongodb-mcp-server",
    source: "built-in",
    category: "database",
  },
  {
    name: "git",
    description: "Git repository operations — log, diff, blame, branch management",
    installCmd: "claude mcp add git -- uvx mcp-server-git",
    source: "built-in",
    category: "vcs",
  },
  {
    name: "fetch",
    description: "Fetch and extract content from URLs",
    installCmd: "claude mcp add fetch -- uvx mcp-server-fetch",
    source: "built-in",
    category: "utility",
  },
  {
    name: "memory",
    description: "Persistent memory and knowledge graph for context across sessions",
    installCmd: "claude mcp add memory -- npx -y @modelcontextprotocol/server-memory",
    source: "built-in",
    category: "utility",
  },
  {
    name: "sequential-thinking",
    description: "Step-by-step reasoning and problem decomposition",
    installCmd: "claude mcp add sequential-thinking -- npx -y @modelcontextprotocol/server-sequential-thinking",
    source: "built-in",
    category: "reasoning",
  },
  {
    name: "filesystem",
    description: "Read, write, and manage files on the local filesystem",
    installCmd: "claude mcp add filesystem -- npx -y @modelcontextprotocol/server-filesystem",
    source: "built-in",
    category: "utility",
  },
];

// Keywords that trigger each built-in MCP suggestion
const STACK_MATCHERS: Record<string, (stack: StackInfo) => boolean> = {
  "solana-mcp-server": (s) =>
    matchesAny(s.frameworks, ["solana", "anchor", "web3"]) ||
    matchesAny(s.languages, ["rust"]) && matchesAny(s.frameworks, ["solana", "anchor"]),
  playwright: (s) =>
    matchesAny(s.testing, ["playwright", "e2e"]) ||
    matchesAny(s.frameworks, ["playwright"]),
  postgres: (s) =>
    matchesAny(s.database, ["postgres", "postgresql", "pg"]),
  mongodb: (s) =>
    matchesAny(s.database, ["mongo", "mongodb", "mongoose"]),
  git: (s) => true, // always useful
  fetch: (_s) => true, // always suggest
  memory: (_s) => true, // always suggest
  "sequential-thinking": (_s) => true, // always suggest
  filesystem: (_s) => false, // only on demand
};

function matchesAny(haystack: string[], needles: string[]): boolean {
  const lower = haystack.map((h) => h.toLowerCase());
  return needles.some((n) => lower.some((h) => h.includes(n.toLowerCase())));
}

function matchBuiltIns(stack: StackInfo): McpServer[] {
  return BUILT_IN_REGISTRY.filter((server) => {
    const matcher = STACK_MATCHERS[server.name];
    return matcher ? matcher(stack) : false;
  });
}

async function aiDiscover(stack: StackInfo): Promise<McpServer[]> {
  const stackDesc = [
    stack.languages.length ? `Languages: ${stack.languages.join(", ")}` : "",
    stack.frameworks.length ? `Frameworks: ${stack.frameworks.join(", ")}` : "",
    stack.buildTools.length ? `Build tools: ${stack.buildTools.join(", ")}` : "",
    stack.testing.length ? `Testing: ${stack.testing.join(", ")}` : "",
    stack.database.length ? `Database: ${stack.database.join(", ")}` : "",
    stack.runtime ? `Runtime: ${stack.runtime}` : "",
  ]
    .filter(Boolean)
    .join(". ");

  const prompt = `Search the web for MCP (Model Context Protocol) servers relevant to this stack: ${stackDesc}. Look on npmjs.com, GitHub, and mcp directories. For each server found, provide: name, description, and the exact \`claude mcp add\` installation command. Return ONLY a JSON array with objects having fields: name, description, installCmd. No markdown fences.`;

  try {
    const output = execSync(`claude -p "${prompt.replace(/"/g, '\\"')}" --output-format text`, {
      encoding: "utf-8",
      timeout: 60_000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Try to extract JSON array from the response
    const jsonMatch = output.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed: Array<{ name: string; description: string; installCmd: string }> = JSON.parse(jsonMatch[0]);

    return parsed
      .filter((item) => item.name && item.installCmd)
      .map((item) => ({
        name: item.name,
        description: item.description || "",
        installCmd: item.installCmd,
        source: "ai-discovery",
        category: "discovered",
      }));
  } catch {
    // AI discovery is best-effort
    return [];
  }
}

export async function discoverMcps(stack: StackInfo): Promise<McpServer[]> {
  // 1. Match built-ins to stack
  const matched = matchBuiltIns(stack);

  // 2. AI-powered discovery (best-effort, parallel)
  let aiResults: McpServer[] = [];
  try {
    aiResults = await aiDiscover(stack);
  } catch {
    // non-fatal
  }

  // 3. Merge and dedup by name (built-in wins)
  const byName = new Map<string, McpServer>();
  for (const server of matched) {
    byName.set(server.name, server);
  }
  for (const server of aiResults) {
    if (!byName.has(server.name)) {
      byName.set(server.name, server);
    }
  }

  return Array.from(byName.values());
}

export async function installMcp(server: McpServer): Promise<boolean> {
  try {
    execSync(server.installCmd, {
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

export async function listInstalledMcps(): Promise<string[]> {
  try {
    const output = execSync("claude mcp list", {
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    // Parse output lines — each line typically starts with the MCP name
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
