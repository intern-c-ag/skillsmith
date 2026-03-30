import { execFile } from "child_process";

export interface StackInfo {
  languages: string[];
  frameworks: string[];
  buildTools: string[];
  testing: string[];
  database: string[];
  runtime: string;
}

export interface ResearchResult {
  topic: string;
  findings: string;
  sources: string[];
}

class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;
  constructor(private max: number) {}
  async acquire(): Promise<void> {
    if (this.active < this.max) { this.active++; return; }
    return new Promise((resolve) => this.queue.push(() => { this.active++; resolve(); }));
  }
  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

function claudeResearch(prompt: string, timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "claude",
      ["-p", prompt, "--output-format", "text"],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout.trim());
      }
    );
  });
}

function extractUrls(text: string): string[] {
  const re = /https?:\/\/[^\s)\]>"']+/g;
  return [...new Set(text.match(re) ?? [])];
}

function getResearchTopics(stack: StackInfo): string[] {
  const topics = new Set<string>();
  for (const f of stack.frameworks) topics.add(f);
  for (const b of stack.buildTools) topics.add(b);
  for (const t of stack.testing) topics.add(t);
  for (const d of stack.database) topics.add(d);
  if (stack.runtime && !["node", "browser"].includes(stack.runtime.toLowerCase())) {
    topics.add(stack.runtime);
  }
  return [...topics].filter(Boolean);
}

async function researchTopic(topic: string, repoName: string, sem: Semaphore): Promise<ResearchResult | null> {
  await sem.acquire();
  try {
    const prompt = `Search the web for current best practices for ${topic} development in 2025-2026. This is for a project called "${repoName}". Focus on: recommended patterns, project structure, common pitfalls, performance tips, latest version features. Format your response as a concise markdown summary. Include URLs to sources you found.`;
    const output = await claudeResearch(prompt);
    return {
      topic,
      findings: output,
      sources: extractUrls(output),
    };
  } catch {
    return null;
  } finally {
    sem.release();
  }
}

export async function researchStack(stack: StackInfo, repoName: string): Promise<ResearchResult[]> {
  const topics = getResearchTopics(stack);
  if (topics.length === 0) return [];

  const sem = new Semaphore(2);
  const results = await Promise.all(topics.map((t) => researchTopic(t, repoName, sem)));
  return results.filter((r): r is ResearchResult => r !== null);
}
