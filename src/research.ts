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

export async function researchStack(stack: StackInfo, repoName: string): Promise<ResearchResult[]> {
  const topics = getResearchTopics(stack);
  if (topics.length === 0) return [];

  // Single batched call for ALL topics
  const topicList = topics.join(", ");
  const prompt = `Search the web for current best practices (2025-2026) for these technologies: ${topicList}. This is for a project called "${repoName}".

For EACH technology, provide a brief summary of:
- Recommended patterns and project structure
- Common pitfalls to avoid
- Latest features/changes
- Include source URLs

Return as a JSON array where each object has:
- "topic": the technology name
- "findings": markdown summary (2-4 paragraphs max)
- "sources": array of URLs

Return ONLY the JSON array, no markdown fences.`;

  try {
    const output = await claudeResearch(prompt, 90000);
    const match = output.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]) as ResearchResult[];
      return parsed.filter(r => r.topic && r.findings);
    }
    // Fallback: treat entire output as one result
    return [{
      topic: topicList,
      findings: output,
      sources: extractUrls(output),
    }];
  } catch {
    return [];
  }
}
