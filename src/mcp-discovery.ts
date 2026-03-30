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
  // Blockchain
  {
    name: "solana-mcp-server",
    description: "Solana + Anchor docs, examples, and expert Q&A from solana.com",
    installCmd: "claude mcp add --transport http solana-mcp-server https://mcp.solana.com/mcp",
    source: "built-in",
    category: "blockchain",
  },

  // Mobile
  {
    name: "react-native",
    description: "React Native docs, components, APIs, and debugging patterns",
    installCmd: "claude mcp add react-native -- npx -y @anthropic/mcp-server-react-native",
    source: "built-in",
    category: "mobile",
  },
  {
    name: "expo",
    description: "Expo SDK docs, EAS Build/Submit, router, and config plugins",
    installCmd: "claude mcp add expo -- npx -y @anthropic/mcp-server-expo",
    source: "built-in",
    category: "mobile",
  },

  // Web frameworks
  {
    name: "nextjs-devtools",
    description: "Next.js dev tools — route debugging, build analysis, config help",
    installCmd: "claude mcp add nextjs-devtools -- npx -y next-devtools-mcp@latest",
    source: "built-in",
    category: "web",
  },

  // Testing
  {
    name: "playwright",
    description: "Browser automation and E2E testing with Playwright",
    installCmd: "claude mcp add playwright -- npx -y @playwright/mcp@latest",
    source: "built-in",
    category: "testing",
  },

  // Databases
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
    name: "redis",
    description: "Redis key-value operations, pub/sub, and data inspection",
    installCmd: "claude mcp add redis -- npx -y @modelcontextprotocol/server-redis",
    source: "built-in",
    category: "database",
  },
  {
    name: "supabase",
    description: "Supabase database, auth, storage, and edge functions",
    installCmd: "claude mcp add supabase -- npx -y @supabase/mcp-server-supabase",
    source: "built-in",
    category: "database",
  },

  // Cloud & infra
  {
    name: "docker",
    description: "Docker container management — build, run, inspect, logs",
    installCmd: "claude mcp add docker -- npx -y @modelcontextprotocol/server-docker",
    source: "built-in",
    category: "infra",
  },
  {
    name: "kubernetes",
    description: "Kubernetes cluster management — pods, services, deployments",
    installCmd: "claude mcp add kubernetes -- npx -y @modelcontextprotocol/server-kubernetes",
    source: "built-in",
    category: "infra",
  },

  // Utilities (always available)
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

  // Project management
  {
    name: "linear",
    description: "Linear issue tracking — create, update, search issues and projects",
    installCmd: "claude mcp add linear -- npx -y @modelcontextprotocol/server-linear",
    source: "built-in",
    category: "project",
  },
  {
    name: "jira",
    description: "Jira issue tracking and project management",
    installCmd: "claude mcp add jira -- npx -y @aashari/mcp-server-atlassian-jira",
    source: "built-in",
    category: "project",
  },

  // Context & docs
  {
    name: "context7",
    description: "Up-to-date library documentation — pulls latest docs for any package",
    installCmd: "claude mcp add context7 -- npx -y @upstash/context7-mcp@latest",
    source: "built-in",
    category: "docs",
  },
];

// Keywords that trigger each built-in MCP suggestion
const STACK_MATCHERS: Record<string, (stack: StackInfo) => boolean> = {
  // Blockchain
  "solana-mcp-server": (s) =>
    matchesAny(s.frameworks, ["solana", "anchor", "web3"]),

  // Mobile
  "react-native": (s) =>
    matchesAny(s.frameworks, ["react-native", "react native", "expo"]),
  expo: (s) =>
    matchesAny(s.frameworks, ["expo"]),

  // Web frameworks
  "nextjs-devtools": (s) =>
    matchesAny(s.frameworks, ["nextjs", "next.js", "next"]),

  // Testing
  playwright: (s) =>
    matchesAny(s.testing, ["playwright", "e2e"]) ||
    matchesAny(s.frameworks, ["playwright"]),

  // Databases
  postgres: (s) =>
    matchesAny(s.database, ["postgres", "postgresql", "pg", "prisma", "drizzle"]),
  mongodb: (s) =>
    matchesAny(s.database, ["mongo", "mongodb", "mongoose"]),
  redis: (s) =>
    matchesAny(s.database, ["redis", "ioredis", "bullmq"]),
  supabase: (s) =>
    matchesAny(s.database, ["supabase"]) || matchesAny(s.frameworks, ["supabase"]),

  // Infra
  docker: (s) =>
    matchesAny(s.buildTools, ["docker", "compose"]),
  kubernetes: (s) =>
    matchesAny(s.buildTools, ["kubernetes", "k8s", "helm"]),

  // Always useful
  git: () => true,
  fetch: () => true,
  memory: () => true,
  "sequential-thinking": () => true,
  filesystem: () => false, // only on demand

  // Context - always suggest for JS/TS projects (most useful there)
  context7: (s) =>
    matchesAny(s.languages, ["typescript", "javascript"]) ||
    matchesAny(s.runtime ? [s.runtime] : [], ["node", "bun", "deno"]),

  // Project mgmt - never auto-suggest, available via AI discovery
  linear: () => false,
  jira: () => false,
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
