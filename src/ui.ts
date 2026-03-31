import * as readline from "node:readline";

const noColor = !!(process.env.NO_COLOR || process.env.TERM === "dumb");

const ansi = (code: string) => (noColor ? (t: string) => t : (t: string) => `\x1b[${code}m${t}\x1b[0m`);

export const colors = {
  bold: ansi("1"),
  dim: ansi("2"),
  green: ansi("32"),
  red: ansi("31"),
  yellow: ansi("33"),
  cyan: ansi("36"),
  magenta: ansi("35"),
};

const BRAILLE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function spinner(text: string) {
  let i = 0;
  let current = text;
  const write = (s: string) => process.stdout.write(s);
  const clear = () => write(`\r\x1b[K`);

  const id = setInterval(() => {
    clear();
    write(`${colors.cyan(BRAILLE[i++ % BRAILLE.length])} ${current}`);
  }, 80);

  return {
    update(t: string) { current = t; },
    succeed(t: string) { clearInterval(id); clear(); write(`${colors.green("✔")} ${t}\n`); },
    fail(t: string) { clearInterval(id); clear(); write(`${colors.red("✖")} ${t}\n`); },
    stop() { clearInterval(id); clear(); },
  };
}

export function banner() {
  const art = `
  ${colors.magenta("┬  ┬┬┌┐ ┌─┐")}
  ${colors.magenta("└┐┌┘│├┴┐├┤ ")}
  ${colors.magenta(" └┘ ┴└─┘└─┘")}
  ${colors.dim("v0.1.0")}
`;
  console.log(art);
}

export function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${colors.cyan("?")} ${question} `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function confirm(question: string): Promise<boolean> {
  const answer = await ask(`${question} ${colors.dim("(y/n)")}`);
  return /^y(es)?$/i.test(answer);
}

export function progressBar(current: number, total: number, width = 30): string {
  const pct = total > 0 ? current / total : 0;
  const filled = Math.round(width * pct);
  const empty = width - filled;
  const bar = colors.green("█".repeat(filled)) + colors.dim("░".repeat(empty));
  const pctStr = `${Math.round(pct * 100)}%`.padStart(4);
  return `${bar} ${pctStr} ${colors.dim(`(${current}/${total})`)}`;
}

export function table(rows: string[][]) {
  if (!rows.length) return;
  const cols = rows[0].length;
  const widths: number[] = Array.from({ length: cols }, () => 0);
  for (const row of rows) {
    for (let c = 0; c < cols; c++) {
      widths[c] = Math.max(widths[c], (row[c] ?? "").length);
    }
  }
  for (const row of rows) {
    const line = row.map((cell, c) => (cell ?? "").padEnd(widths[c])).join("  ");
    console.log(line);
  }
}
