/**
 * Pre-written skill and agent templates for vibe CLI.
 * Replaces slow AI generation with instant hardcoded templates.
 */

import type { StackInfo } from './scanner.js';
import { getDomainAgents } from './domain-agents.js';

export interface Templates {
  agents: Record<string, string>;
  skills: Record<string, string>;
  commands: Record<string, string>;
  settings: object;
  config: object;
}

// ─── Helpers ───────────────────────────────────────────────

function has(stack: StackInfo, ...items: string[]): boolean {
  const all = [
    ...stack.languages,
    ...stack.frameworks,
    ...stack.buildTools,
    ...stack.testing,
    ...stack.database,
    stack.runtime,
  ].map(s => s.toLowerCase());
  return items.some(i => all.some(a => a.includes(i.toLowerCase())));
}

function stackList(stack: StackInfo): string {
  const parts = [...stack.languages, ...stack.frameworks].filter(Boolean);
  return parts.length ? parts.join(', ') : 'this project';
}

// ─── AGENTS ────────────────────────────────────────────────

function agentResearchWeb(stack: StackInfo): string {
  const techs = stackList(stack);
  return `# Research Web Agent

## Role
Research best practices, patterns, and solutions online before implementing changes.

## When to Use
- Before starting a new feature or refactor
- When encountering unfamiliar APIs or libraries
- When choosing between implementation approaches

## Stack Context
This project uses **${techs}**. Prioritize sources specific to these technologies.

## Process
1. Identify the problem or feature requirements
2. Search for current best practices (prefer official docs, then reputable blogs)
3. Look for common pitfalls and anti-patterns
4. Summarize findings with links before writing code
5. Propose an implementation plan based on research

## Search Priority
1. Official documentation for ${techs}
2. GitHub issues and discussions
3. Stack Overflow (recent answers, check dates)
4. Blog posts from recognized experts
5. RFC/spec documents when relevant

## Output Format
\`\`\`markdown
## Research: [Topic]

### Summary
[1-2 sentence overview]

### Key Findings
- Finding 1 (source: [link])
- Finding 2 (source: [link])

### Recommended Approach
[Concrete recommendation with reasoning]

### Alternatives Considered
[Why they were rejected]
\`\`\`

## Rules
- Always cite sources
- Prefer recent content (< 2 years old)
- Flag deprecated patterns explicitly
- If docs conflict, note the discrepancy
`;
}

function agentCommitManager(_stack: StackInfo): string {
  return `# Commit Manager Agent

## Role
Handle git workflow: staging, conventional commits, branch naming, and PR descriptions.

## Conventional Commits
Format: \`<type>(<scope>): <description>\`

### Types
- **feat**: New feature (\`feat(auth): add OAuth2 login flow\`)
- **fix**: Bug fix (\`fix(api): handle null response in user endpoint\`)
- **docs**: Documentation only (\`docs(readme): add deployment instructions\`)
- **style**: Formatting, no logic change (\`style: run prettier on src/\`)
- **refactor**: Code change, no feature/fix (\`refactor(db): extract query builder\`)
- **perf**: Performance improvement (\`perf(search): add index on email column\`)
- **test**: Adding/fixing tests (\`test(auth): add login failure scenarios\`)
- **chore**: Build, CI, deps (\`chore(deps): bump express to 4.19\`)
- **ci**: CI config (\`ci: add GitHub Actions deploy workflow\`)

### Good Commit Messages
\`\`\`
feat(cart): add quantity validation before checkout

- Validate quantity > 0 and <= stock
- Show inline error message
- Disable checkout button on invalid state

Closes #142
\`\`\`

\`\`\`
fix(auth): prevent token refresh race condition

Multiple simultaneous 401s would each trigger a refresh,
causing token invalidation. Now queues refreshes behind
a single promise.

Fixes #89
\`\`\`

### Bad Commit Messages
- \`fix stuff\` — no scope, no description
- \`WIP\` — squash before merging
- \`update\` — update what?

## Branch Naming
- Feature: \`feat/<ticket>-<short-desc>\` → \`feat/142-cart-validation\`
- Fix: \`fix/<ticket>-<short-desc>\` → \`fix/89-token-race\`
- Chore: \`chore/<desc>\` → \`chore/update-ci-config\`

## PR Description Template
\`\`\`markdown
## What
[Brief description of changes]

## Why
[Motivation, link to issue]

## How
[Implementation approach]

## Testing
[How this was tested]

## Checklist
- [ ] Tests pass
- [ ] Linted
- [ ] Docs updated (if needed)
\`\`\`

## Process
1. \`git status\` to review changes
2. Stage related changes together (don't mix features)
3. Write conventional commit message
4. If multiple logical changes, make multiple commits
5. Push to feature branch
`;
}

function agentTester(stack: StackInfo): string {
  let testContent: string;

  if (has(stack, 'rust')) {
    testContent = `## Stack: Rust

### Unit Tests
\`\`\`rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_valid_input() {
        let result = parse("hello");
        assert_eq!(result, Ok("hello".to_string()));
    }

    #[test]
    #[should_panic(expected = "empty input")]
    fn test_parse_empty_panics() {
        parse("");
    }
}
\`\`\`

### Async Tests
\`\`\`rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_fetch_user() {
        let user = fetch_user(1).await.unwrap();
        assert_eq!(user.name, "Alice");
    }
}
\`\`\`

### Property-Based Testing (proptest)
\`\`\`rust
use proptest::prelude::*;

proptest! {
    #[test]
    fn roundtrip_serialization(input in "\\\\PC{1,100}") {
        let encoded = encode(&input);
        let decoded = decode(&encoded).unwrap();
        prop_assert_eq!(input, decoded);
    }
}
\`\`\`

### Commands
- Run all: \`cargo test\`
- Run specific: \`cargo test test_name\`
- With output: \`cargo test -- --nocapture\`
- Doc tests: \`cargo test --doc\``;
  } else if (has(stack, 'vitest')) {
    testContent = `## Stack: TypeScript + Vitest

### Unit Tests
\`\`\`typescript
import { describe, it, expect, vi } from 'vitest';
import { calculateTotal } from './cart';

describe('calculateTotal', () => {
  it('sums item prices', () => {
    const items = [{ price: 10 }, { price: 20 }];
    expect(calculateTotal(items)).toBe(30);
  });

  it('applies discount', () => {
    const items = [{ price: 100 }];
    expect(calculateTotal(items, 0.1)).toBe(90);
  });

  it('returns 0 for empty cart', () => {
    expect(calculateTotal([])).toBe(0);
  });
});
\`\`\`

### Mocking
\`\`\`typescript
import { vi } from 'vitest';
import { fetchUser } from './api';

vi.mock('./api', () => ({
  fetchUser: vi.fn(),
}));

it('displays user name', async () => {
  vi.mocked(fetchUser).mockResolvedValue({ name: 'Alice' });
  const result = await getDisplayName(1);
  expect(result).toBe('Alice');
  expect(fetchUser).toHaveBeenCalledWith(1);
});
\`\`\`

### Commands
- Run all: \`npx vitest run\`
- Watch: \`npx vitest\`
- Coverage: \`npx vitest run --coverage\`
- Single file: \`npx vitest run src/cart.test.ts\``;
  } else if (has(stack, 'jest')) {
    testContent = `## Stack: TypeScript + Jest

### Unit Tests
\`\`\`typescript
import { calculateTotal } from './cart';

describe('calculateTotal', () => {
  it('sums item prices', () => {
    const items = [{ price: 10 }, { price: 20 }];
    expect(calculateTotal(items)).toBe(30);
  });

  it('applies discount', () => {
    const items = [{ price: 100 }];
    expect(calculateTotal(items, 0.1)).toBe(90);
  });
});
\`\`\`

### Mocking
\`\`\`typescript
jest.mock('./api');
import { fetchUser } from './api';

const mockFetchUser = fetchUser as jest.MockedFunction<typeof fetchUser>;

it('displays user name', async () => {
  mockFetchUser.mockResolvedValue({ name: 'Alice' });
  const result = await getDisplayName(1);
  expect(result).toBe('Alice');
});
\`\`\`

### Commands
- Run all: \`npx jest\`
- Watch: \`npx jest --watch\`
- Coverage: \`npx jest --coverage\`
- Single file: \`npx jest src/cart.test.ts\``;
  } else if (has(stack, 'python', 'pytest')) {
    testContent = `## Stack: Python + pytest

### Unit Tests
\`\`\`python
def test_calculate_total():
    items = [{"price": 10}, {"price": 20}]
    assert calculate_total(items) == 30

def test_calculate_total_with_discount():
    items = [{"price": 100}]
    assert calculate_total(items, discount=0.1) == 90
\`\`\`

### Fixtures
\`\`\`python
import pytest

@pytest.fixture
def db_session():
    session = create_test_session()
    yield session
    session.rollback()
    session.close()

def test_create_user(db_session):
    user = User(name="Alice")
    db_session.add(user)
    db_session.commit()
    assert user.id is not None
\`\`\`

### Parametrize
\`\`\`python
@pytest.mark.parametrize("input,expected", [
    ("hello", "HELLO"),
    ("", ""),
    ("123", "123"),
])
def test_uppercase(input, expected):
    assert uppercase(input) == expected
\`\`\`

### Commands
- Run all: \`pytest\`
- Verbose: \`pytest -v\`
- Coverage: \`pytest --cov=src\`
- Single: \`pytest tests/test_cart.py::test_calculate_total\``;
  } else if (has(stack, 'go')) {
    testContent = `## Stack: Go

### Table-Driven Tests
\`\`\`go
func TestCalculateTotal(t *testing.T) {
    tests := []struct {
        name     string
        items    []Item
        discount float64
        want     float64
    }{
        {"empty cart", nil, 0, 0},
        {"single item", []Item{{Price: 10}}, 0, 10},
        {"with discount", []Item{{Price: 100}}, 0.1, 90},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := CalculateTotal(tt.items, tt.discount)
            if got != tt.want {
                t.Errorf("got %v, want %v", got, tt.want)
            }
        })
    }
}
\`\`\`

### With Testify
\`\`\`go
import "github.com/stretchr/testify/assert"

func TestCreateUser(t *testing.T) {
    user, err := CreateUser("Alice")
    assert.NoError(t, err)
    assert.Equal(t, "Alice", user.Name)
    assert.NotZero(t, user.ID)
}
\`\`\`

### Commands
- Run all: \`go test ./...\`
- Verbose: \`go test -v ./...\`
- Coverage: \`go test -coverprofile=coverage.out ./...\`
- Single: \`go test -run TestCalculateTotal ./pkg/cart\``;
  } else {
    testContent = `## General Testing Best Practices

### Structure
- One test file per source file
- Group related tests together
- Use descriptive test names that explain the scenario
- Follow Arrange-Act-Assert pattern

### What to Test
- Happy path (expected inputs)
- Edge cases (empty, null, boundary values)
- Error cases (invalid input, network failures)
- Integration points (API calls, DB queries)

### What NOT to Test
- Third-party library internals
- Simple getters/setters with no logic
- Implementation details (test behavior, not structure)

### Naming
- \`test_<function>_<scenario>_<expected>\`
- Example: \`test_calculateTotal_withDiscount_returnsReducedPrice\``;
  }

  return `# Tester Agent

## Role
Create and maintain tests for the codebase. Ensure good coverage of business logic, edge cases, and integration points.

${testContent}

## Guidelines
- Test behavior, not implementation
- Each test should test ONE thing
- Tests should be independent (no shared mutable state)
- Use descriptive names: what is being tested, under what conditions, expected result
- Prefer real objects over mocks when feasible
- Mock external dependencies (network, filesystem, databases)
- Keep tests fast — slow tests don't get run

## Coverage Targets
- Business logic: 80%+
- Utilities/helpers: 90%+
- UI components: 60%+ (focus on behavior)
- Generated code: skip
`;
}

function agentReviewer(stack: StackInfo): string {
  const concerns: string[] = [];

  if (has(stack, 'rust')) {
    concerns.push(`### Rust-Specific
- Unnecessary \`unsafe\` blocks — can this be done safely?
- Lifetime issues — are borrows minimal and clear?
- \`.unwrap()\` / \`.expect()\` in non-test code — use proper error handling
- Large \`.clone()\` calls — can we borrow instead?
- Missing \`Send + Sync\` bounds for concurrent code`);
  }
  if (has(stack, 'typescript', 'javascript')) {
    concerns.push(`### TypeScript-Specific
- \`any\` type usage — prefer \`unknown\` + type narrowing
- Missing null checks on optional chains
- Unhandled promise rejections
- Mutable shared state in async code
- Large bundle imports (tree-shaking issues)`);
  }
  if (has(stack, 'python')) {
    concerns.push(`### Python-Specific
- Missing type hints on public functions
- Bare \`except:\` clauses — catch specific exceptions
- Mutable default arguments
- Missing \`__init__.py\` or circular imports
- SQL string interpolation (use parameterized queries)`);
  }
  if (has(stack, 'go')) {
    concerns.push(`### Go-Specific
- Unchecked errors (\`err\` ignored)
- Goroutine leaks (missing context cancellation)
- Race conditions (run \`go test -race\`)
- Nil pointer dereferences
- Large interfaces (prefer small, composable interfaces)`);
  }
  if (has(stack, 'solana', 'anchor')) {
    concerns.push(`### Solana/Anchor-Specific
- Missing signer validation on authority accounts
- Missing owner checks on deserialized accounts
- Arithmetic overflow (use checked_add/checked_mul)
- PDA seed validation — ensure seeds are deterministic and unique
- Rent exemption — ensure accounts meet minimum balance
- Missing close account logic (reclaim rent)
- CPI calls — verify program IDs`);
  }
  if (has(stack, 'react', 'next')) {
    concerns.push(`### React-Specific
- Missing dependency arrays in useEffect
- State updates in render path
- Prop drilling (consider context or composition)
- Missing error boundaries
- Unnecessary re-renders (memo, useMemo, useCallback)`);
  }

  const stackConcerns = concerns.length > 0
    ? `## Stack-Specific Concerns\n\n${concerns.join('\n\n')}`
    : '';

  return `# Code Reviewer Agent

## Role
Review code for security, performance, readability, and correctness.

## Review Checklist

### Security
- [ ] No hardcoded secrets or credentials
- [ ] Input validation on all external data
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS prevention (output encoding)
- [ ] Authentication/authorization checks present
- [ ] No sensitive data in logs

### Performance
- [ ] No N+1 queries
- [ ] Appropriate indexing for DB queries
- [ ] No unnecessary allocations in hot paths
- [ ] Pagination for list endpoints
- [ ] Caching where appropriate

### Readability
- [ ] Clear variable and function names
- [ ] Functions do one thing
- [ ] No deeply nested conditionals (< 3 levels)
- [ ] Comments explain WHY, not WHAT
- [ ] Consistent error handling pattern

### Correctness
- [ ] Edge cases handled (empty, null, boundary)
- [ ] Error paths don't swallow errors
- [ ] Concurrent access is safe
- [ ] Resources are cleaned up (connections, handles)

${stackConcerns}

## Output Format
\`\`\`markdown
## Review: [file or PR title]

### 🔴 Must Fix
- [Critical issues]

### 🟡 Should Fix
- [Important improvements]

### 🟢 Suggestions
- [Nice-to-have improvements]

### ✅ Good
- [Things done well — always include positive feedback]
\`\`\`
`;
}

// ─── SKILLS ────────────────────────────────────────────────

const SKILL_GIT_WORKFLOW = `# Git Workflow

## Description
Branching strategy, conventional commits, and PR workflow for consistent collaboration.

## Patterns

### Branch Strategy (GitHub Flow)
\`\`\`
main ──────────────────────────────────────────►
       \\                        /
        feat/142-add-auth ────►  (PR + squash merge)
\`\`\`

- \`main\` is always deployable
- Feature branches from \`main\`
- PR required for merge
- Squash merge to keep history clean

### Conventional Commits
\`\`\`
<type>(<scope>): <short summary>

<body — optional, explain WHY>

<footer — optional, references>
\`\`\`

Types: feat, fix, docs, style, refactor, perf, test, chore, ci

### Commit Workflow
\`\`\`bash
# Stage related changes only
git add src/auth/ tests/auth/

# Write descriptive commit
git commit -m "feat(auth): add JWT refresh token rotation

Tokens are rotated on each refresh to prevent replay attacks.
Old tokens are invalidated immediately.

Closes #142"
\`\`\`

### PR Workflow
1. Create feature branch: \`git checkout -b feat/142-add-auth\`
2. Make small, focused commits
3. Push and open PR with description
4. Address review comments (don't force-push during review)
5. Squash merge when approved

## Conventions
- Branch names: \`<type>/<ticket>-<description>\`
- One logical change per commit
- PR title follows conventional commit format
- Delete branch after merge

## Anti-Patterns
- Committing directly to main
- Giant PRs (>500 lines) — split them
- Merge commits on feature branches (rebase instead)
- \`git push --force\` on shared branches
- WIP commits in main history

## References
- [Conventional Commits](https://www.conventionalcommits.org/)
- [GitHub Flow](https://docs.github.com/en/get-started/quickstart/github-flow)
`;

const SKILL_SECURITY_SCAN = `# Security Scan

## Description
Identify security vulnerabilities following OWASP top 10 and secure coding practices.

## Patterns

### Input Validation
\`\`\`typescript
// ✅ Good: validate and sanitize
import { z } from 'zod';

const UserInput = z.object({
  email: z.string().email().max(254),
  name: z.string().min(1).max(100).trim(),
  age: z.number().int().min(0).max(150),
});

function createUser(input: unknown) {
  const data = UserInput.parse(input); // throws on invalid
  return db.users.create(data);
}
\`\`\`

### SQL Injection Prevention
\`\`\`typescript
// ❌ Bad
db.query(\`SELECT * FROM users WHERE id = \${userId}\`);

// ✅ Good: parameterized query
db.query('SELECT * FROM users WHERE id = $1', [userId]);
\`\`\`

### Authentication
\`\`\`typescript
// Always hash passwords
import bcrypt from 'bcrypt';
const hash = await bcrypt.hash(password, 12);

// Compare in constant time
const valid = await bcrypt.compare(input, stored);
\`\`\`

### Secret Management
\`\`\`bash
# .gitignore — never commit secrets
.env
.env.local
*.pem
*.key
\`\`\`

### HTTP Security Headers
\`\`\`
Content-Security-Policy: default-src 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Strict-Transport-Security: max-age=31536000; includeSubDomains
\`\`\`

## Conventions
- Validate all external input at the boundary
- Use allowlists over denylists
- Principle of least privilege for permissions
- Log security events (login, failed auth, permission denied)
- Never log passwords, tokens, or PII

## Anti-Patterns
- Trusting client-side validation alone
- Rolling your own crypto
- Storing secrets in code or env vars committed to git
- Disabling CORS for convenience
- Using HTTP in production
- Catching and swallowing auth errors

## References
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/)
`;

const SKILL_QUALITY_GATE = `# Quality Gate

## Description
Code quality checks, linting, and formatting standards for consistent codebases.

## Patterns

### Pre-commit Checks
\`\`\`bash
# Run before every commit
lint        # Code style and errors
typecheck   # Type correctness
test        # Unit tests pass
format      # Consistent formatting
\`\`\`

### Linting Configuration
\`\`\`jsonc
// ESLint (TypeScript)
{
  "extends": ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  "rules": {
    "no-console": "warn",
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }]
  }
}
\`\`\`

### Code Complexity
- Functions < 30 lines (prefer < 15)
- Cyclomatic complexity < 10
- Max nesting depth: 3 levels
- Max file length: 300 lines

### Naming Conventions
\`\`\`
Functions: camelCase (verbs) → getUserById, calculateTotal
Classes: PascalCase (nouns) → UserService, CartItem
Constants: UPPER_SNAKE → MAX_RETRIES, API_BASE_URL
Files: kebab-case → user-service.ts, cart-item.rs
Types: PascalCase → UserResponse, CartState
\`\`\`

## Conventions
- Format on save (configure editor)
- Lint in CI — block merge on failures
- No disabled lint rules without comment explaining why
- Keep dependencies up to date (monthly review)
- Remove dead code — don't comment it out

## Anti-Patterns
- Disabling lint rules globally
- Inconsistent formatting across files
- TODO comments without issue links
- Commented-out code committed
- Ignoring compiler/linter warnings

## References
- [ESLint](https://eslint.org/)
- [Prettier](https://prettier.io/)
- [Clippy (Rust)](https://doc.rust-lang.org/clippy/)
- [Ruff (Python)](https://docs.astral.sh/ruff/)
`;

const SKILL_DEBUGGING = `# Debugging Patterns

## Description
Systematic debugging, logging, and profiling techniques.

## Patterns

### Systematic Debugging Process
1. **Reproduce** — Get a minimal, reliable reproduction
2. **Isolate** — Binary search to narrow the cause
3. **Identify** — Read the actual error, check the actual values
4. **Fix** — Change ONE thing at a time
5. **Verify** — Confirm fix AND no regressions
6. **Prevent** — Add a test for this case

### Effective Logging
\`\`\`typescript
// ❌ Bad
console.log("here");
console.log(data);

// ✅ Good: structured, contextual
logger.info('User login attempt', {
  userId: user.id,
  ip: req.ip,
  method: 'oauth2',
  success: true,
  durationMs: Date.now() - start,
});
\`\`\`

### Binary Search Debugging
\`\`\`
Problem: API returns wrong data

1. Check: Is the DB query correct?        → Yes
2. Check: Is the raw query result correct? → Yes
3. Check: Is the transform correct?        → NO ← Found it
4. Narrow: Which transform step fails?
\`\`\`

### Debug Checklist
- [ ] Read the FULL error message (including cause chain)
- [ ] Check recent changes (\`git diff\`, \`git log --oneline -10\`)
- [ ] Verify assumptions (print actual values, not what you think they are)
- [ ] Check environment (env vars, config, versions)
- [ ] Search issue trackers for the error message
- [ ] Reproduce in isolation (minimal test case)

### Profiling
\`\`\`typescript
// Quick timing
console.time('operation');
await doExpensiveThing();
console.timeEnd('operation');

// Node.js: built-in profiler
// node --prof app.js
// node --prof-process isolate-*.log > profile.txt
\`\`\`

## Conventions
- Log at appropriate levels: error > warn > info > debug
- Include correlation IDs in distributed systems
- Remove debug logs before committing
- Use structured logging (JSON) in production

## Anti-Patterns
- Printf debugging in production code
- Catching and silencing errors
- Changing multiple things at once
- Assuming instead of verifying
- Not reading the full stack trace
- "It works on my machine" without checking env differences

## References
- [Chrome DevTools](https://developer.chrome.com/docs/devtools/)
- [Node.js Debugging Guide](https://nodejs.org/en/docs/guides/debugging-getting-started)
`;

const SKILL_RUST = `# Rust Patterns

## Description
Idiomatic Rust: ownership, error handling, async, and trait design patterns.

## Patterns

### Error Handling with thiserror + anyhow
\`\`\`rust
// Library code: use thiserror for typed errors
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("user {0} not found")]
    UserNotFound(u64),
    #[error("database error")]
    Database(#[from] sqlx::Error),
    #[error("validation failed: {0}")]
    Validation(String),
}

// Application code: use anyhow for convenience
use anyhow::{Context, Result};

async fn process_order(id: u64) -> Result<()> {
    let order = db::get_order(id)
        .await
        .context("failed to fetch order")?;
    validate(&order).context("order validation failed")?;
    Ok(())
}
\`\`\`

### Builder Pattern
\`\`\`rust
pub struct Config {
    host: String,
    port: u16,
    workers: usize,
}

impl Config {
    pub fn builder() -> ConfigBuilder {
        ConfigBuilder::default()
    }
}

#[derive(Default)]
pub struct ConfigBuilder {
    host: Option<String>,
    port: Option<u16>,
    workers: Option<usize>,
}

impl ConfigBuilder {
    pub fn host(mut self, host: impl Into<String>) -> Self {
        self.host = Some(host.into());
        self
    }
    pub fn port(mut self, port: u16) -> Self {
        self.port = Some(port);
        self
    }
    pub fn build(self) -> Config {
        Config {
            host: self.host.unwrap_or_else(|| "localhost".into()),
            port: self.port.unwrap_or(8080),
            workers: self.workers.unwrap_or(4),
        }
    }
}
\`\`\`

### Async with Tokio
\`\`\`rust
use tokio::sync::mpsc;

async fn worker(mut rx: mpsc::Receiver<Job>) {
    while let Some(job) = rx.recv().await {
        if let Err(e) = process(job).await {
            tracing::error!(?e, "job failed");
        }
    }
}
\`\`\`

### Derive Macros
\`\`\`rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct User {
    pub id: u64,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
}
\`\`\`

## Conventions
- Prefer \`&str\` over \`String\` in function params
- Use \`impl Into<String>\` for owned string params
- Return \`Result\` from fallible functions, never panic
- Use \`tracing\` over \`log\` for structured logging
- Prefer \`Vec::with_capacity\` when size is known

## Anti-Patterns
- \`.unwrap()\` in non-test code
- \`.clone()\` to "fix" borrow checker — understand ownership first
- \`unsafe\` without a safety comment
- Mutex in async code (use tokio::sync::Mutex)
- Giant match arms — extract to functions

## References
- [Rust Book](https://doc.rust-lang.org/book/)
- [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/)
- [Tokio Tutorial](https://tokio.rs/tokio/tutorial)
`;

const SKILL_TYPESCRIPT = `# TypeScript Strict

## Description
Strict TypeScript patterns: type narrowing, utility types, validation, and discriminated unions.

## Patterns

### Strict Config
\`\`\`jsonc
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true
  }
}
\`\`\`

### Discriminated Unions
\`\`\`typescript
type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function handle(result: Result<User>) {
  if (result.ok) {
    console.log(result.data.name); // TS knows data exists
  } else {
    console.error(result.error);   // TS knows error exists
  }
}
\`\`\`

### Type Narrowing
\`\`\`typescript
// Type guard
function isUser(val: unknown): val is User {
  return typeof val === 'object' && val !== null && 'id' in val && 'name' in val;
}

// Exhaustive switch
type Status = 'active' | 'inactive' | 'banned';

function getLabel(status: Status): string {
  switch (status) {
    case 'active': return 'Active';
    case 'inactive': return 'Inactive';
    case 'banned': return 'Banned';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
\`\`\`

### Zod Validation
\`\`\`typescript
import { z } from 'zod';

const CreateUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.enum(['admin', 'user']).default('user'),
});

type CreateUser = z.infer<typeof CreateUserSchema>;

function createUser(input: unknown): CreateUser {
  return CreateUserSchema.parse(input);
}
\`\`\`

### Utility Types
\`\`\`typescript
// Pick fields for API response
type UserSummary = Pick<User, 'id' | 'name'>;

// Make all fields optional for updates
type UpdateUser = Partial<Omit<User, 'id'>>;

// Require specific fields
type CreateUser = Required<Pick<User, 'name' | 'email'>> & Partial<User>;

// Record for maps
type FeatureFlags = Record<string, boolean>;
\`\`\`

## Conventions
- Never use \`any\` — use \`unknown\` + narrowing
- Prefer \`interface\` for objects, \`type\` for unions/intersections
- Export types alongside their functions
- Validate external data at boundaries (API input, env vars, file reads)

## Anti-Patterns
- \`as\` type assertions (masks real errors)
- \`// @ts-ignore\` without explanation
- Optional chaining without handling undefined: \`user?.name.toUpperCase()\`
- \`enum\` for simple values (use const objects or union types)
- Non-null assertion \`!\` without certainty

## References
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/)
- [Total TypeScript](https://www.totaltypescript.com/)
- [Zod](https://zod.dev/)
`;

const SKILL_REACT = `# React Patterns

## Description
Modern React patterns: hooks, composition, state management, and React 19 features.

## Patterns

### Component Composition
\`\`\`tsx
// ✅ Composition over prop drilling
function Card({ children }: { children: React.ReactNode }) {
  return <div className="card">{children}</div>;
}

function CardHeader({ title }: { title: string }) {
  return <h2 className="card-header">{title}</h2>;
}

// Usage
<Card>
  <CardHeader title="Profile" />
  <UserAvatar user={user} />
</Card>
\`\`\`

### Custom Hooks
\`\`\`tsx
function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

// Usage
function Search() {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    if (debouncedQuery) fetchResults(debouncedQuery);
  }, [debouncedQuery]);
}
\`\`\`

### Error Boundaries
\`\`\`tsx
import { ErrorBoundary } from 'react-error-boundary';

function ErrorFallback({ error, resetErrorBoundary }) {
  return (
    <div role="alert">
      <p>Something went wrong:</p>
      <pre>{error.message}</pre>
      <button onClick={resetErrorBoundary}>Try again</button>
    </div>
  );
}

<ErrorBoundary FallbackComponent={ErrorFallback}>
  <App />
</ErrorBoundary>
\`\`\`

### Server Components (React 19)
\`\`\`tsx
// Server Component (default in Next.js App Router)
async function UserProfile({ userId }: { userId: string }) {
  const user = await db.users.findById(userId); // Direct DB access
  return <div>{user.name}</div>;
}

// Client Component — add 'use client' only when needed
'use client';
function LikeButton() {
  const [liked, setLiked] = useState(false);
  return <button onClick={() => setLiked(!liked)}>{liked ? '❤️' : '🤍'}</button>;
}
\`\`\`

## Conventions
- One component per file
- Co-locate tests, styles, and types with components
- Lift state only as high as needed
- Prefer server components; add 'use client' only for interactivity

## Anti-Patterns
- useEffect for derived state (use useMemo or compute in render)
- Prop drilling > 3 levels (use context or composition)
- Fetching in useEffect without cleanup/cancellation
- Inline object/array literals in JSX (causes re-renders)
- Giant components (> 150 lines) — extract sub-components

## References
- [React Docs](https://react.dev/)
- [React 19 Blog](https://react.dev/blog)
`;

const SKILL_NEXTJS = `# Next.js App Router

## Description
App Router conventions, server actions, route handlers, metadata, and caching in Next.js 14+.

## Patterns

### File Conventions
\`\`\`
app/
  layout.tsx        # Root layout (wraps all pages)
  page.tsx          # Home page (/)
  loading.tsx       # Loading UI (Suspense boundary)
  error.tsx         # Error UI (Error boundary)
  not-found.tsx     # 404 page
  api/
    users/
      route.ts      # API route: GET/POST /api/users
  dashboard/
    layout.tsx      # Nested layout
    page.tsx         # /dashboard
    [id]/
      page.tsx      # /dashboard/:id (dynamic)
\`\`\`

### Server Actions
\`\`\`tsx
// app/actions.ts
'use server';

import { revalidatePath } from 'next/cache';

export async function createPost(formData: FormData) {
  const title = formData.get('title') as string;
  await db.posts.create({ title });
  revalidatePath('/posts');
}

// app/posts/new/page.tsx
export default function NewPost() {
  return (
    <form action={createPost}>
      <input name="title" required />
      <button type="submit">Create</button>
    </form>
  );
}
\`\`\`

### Route Handlers
\`\`\`typescript
// app/api/users/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = Number(searchParams.get('page') ?? 1);
  const users = await db.users.findMany({ skip: (page - 1) * 20, take: 20 });
  return NextResponse.json(users);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const user = await db.users.create(body);
  return NextResponse.json(user, { status: 201 });
}
\`\`\`

### Metadata
\`\`\`typescript
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'View your dashboard',
  openGraph: { title: 'Dashboard', description: 'View your dashboard' },
};

// Dynamic metadata
export async function generateMetadata({ params }): Promise<Metadata> {
  const post = await getPost(params.id);
  return { title: post.title };
}
\`\`\`

## Conventions
- Default to Server Components; add 'use client' only for interactivity
- Use Server Actions for mutations (not API routes)
- Use route.ts for public APIs consumed by external clients
- Co-locate components with their pages when page-specific

## Anti-Patterns
- 'use client' on everything (defeats server rendering)
- Fetching in client components when server components suffice
- Using API routes for internal mutations (use Server Actions)
- Not handling loading/error states (add loading.tsx, error.tsx)
- Ignoring revalidation — stale data without revalidatePath/revalidateTag

## References
- [Next.js Docs](https://nextjs.org/docs)
- [App Router](https://nextjs.org/docs/app)
`;

const SKILL_PYTHON = `# Python Patterns

## Description
Modern Python: type hints, dataclasses, async, packaging, and project structure.

## Patterns

### Type Hints
\`\`\`python
from typing import Optional
from collections.abc import Sequence

def get_users(
    limit: int = 10,
    active_only: bool = True,
) -> list[User]:
    ...

def find_user(user_id: int) -> Optional[User]:
    ...

# Python 3.10+ union syntax
def process(value: str | int) -> None:
    ...
\`\`\`

### Dataclasses
\`\`\`python
from dataclasses import dataclass, field
from datetime import datetime

@dataclass
class User:
    id: int
    name: str
    email: str
    created_at: datetime = field(default_factory=datetime.utcnow)
    tags: list[str] = field(default_factory=list)

    @property
    def display_name(self) -> str:
        return self.name.title()
\`\`\`

### Async/Await
\`\`\`python
import asyncio
import httpx

async def fetch_users(ids: list[int]) -> list[User]:
    async with httpx.AsyncClient() as client:
        tasks = [client.get(f"/users/{id}") for id in ids]
        responses = await asyncio.gather(*tasks)
        return [User(**r.json()) for r in responses]
\`\`\`

### Project Layout
\`\`\`
my-project/
  pyproject.toml    # Project config (replaces setup.py)
  src/
    my_package/
      __init__.py
      models.py
      services.py
  tests/
    conftest.py
    test_models.py
\`\`\`

## Conventions
- Use \`pyproject.toml\` for project config
- Type hint all public functions
- Use \`ruff\` for linting and formatting
- Prefer \`pathlib.Path\` over \`os.path\`
- Use virtual environments always

## Anti-Patterns
- Mutable default arguments: \`def f(items=[])\`
- Bare \`except:\` — catch specific exceptions
- \`from module import *\` — pollutes namespace
- Global mutable state
- String formatting for SQL queries

## References
- [Python Type Hints](https://docs.python.org/3/library/typing.html)
- [Ruff](https://docs.astral.sh/ruff/)
- [Modern Python Packaging](https://packaging.python.org/)
`;

const SKILL_GO = `# Go Patterns

## Description
Idiomatic Go: error handling, interfaces, concurrency, and project layout.

## Patterns

### Error Handling
\`\`\`go
import "fmt"

// Custom errors
type NotFoundError struct {
    Resource string
    ID       int64
}

func (e *NotFoundError) Error() string {
    return fmt.Sprintf("%s %d not found", e.Resource, e.ID)
}

// Wrapping errors
func GetUser(id int64) (*User, error) {
    user, err := db.FindUser(id)
    if err != nil {
        return nil, fmt.Errorf("GetUser(%d): %w", id, err)
    }
    return user, nil
}

// Checking wrapped errors
if errors.Is(err, sql.ErrNoRows) { ... }
var nfe *NotFoundError
if errors.As(err, &nfe) { ... }
\`\`\`

### Small Interfaces
\`\`\`go
// ✅ Small, composable
type Reader interface {
    Read(p []byte) (n int, err error)
}

type UserStore interface {
    GetUser(ctx context.Context, id int64) (*User, error)
    CreateUser(ctx context.Context, u *User) error
}
\`\`\`

### Concurrency
\`\`\`go
func processItems(ctx context.Context, items []Item) error {
    g, ctx := errgroup.WithContext(ctx)

    for _, item := range items {
        item := item // capture loop variable
        g.Go(func() error {
            return process(ctx, item)
        })
    }

    return g.Wait()
}
\`\`\`

### Project Layout
\`\`\`
cmd/
  server/main.go    # Entry point
internal/
  user/             # Domain package
    handler.go
    service.go
    store.go
pkg/                # Public libraries (optional)
\`\`\`

## Conventions
- Accept interfaces, return structs
- Errors are values — handle them explicitly
- Use \`context.Context\` as first parameter
- Keep packages small and focused
- Use \`go vet\` and \`golangci-lint\`

## Anti-Patterns
- Ignoring errors: \`result, _ := doThing()\`
- Large interfaces (> 5 methods) — split them
- init() functions — prefer explicit initialization
- Package-level mutable state
- Goroutine leaks (always cancel contexts)

## References
- [Effective Go](https://go.dev/doc/effective_go)
- [Go Code Review Comments](https://go.dev/wiki/CodeReviewComments)
- [Standard Project Layout](https://github.com/golang-standards/project-layout)
`;

const SKILL_ANCHOR = `# Anchor Patterns

## Description
Anchor framework patterns for Solana program development: account validation, PDAs, CPIs, and security.

## Patterns

### Account Validation
\`\`\`rust
#[derive(Accounts)]
pub struct CreatePost<'info> {
    #[account(
        init,
        payer = author,
        space = 8 + Post::INIT_SPACE,
        seeds = [b"post", author.key().as_ref(), &post_id.to_le_bytes()],
        bump,
    )]
    pub post: Account<'info, Post>,

    #[account(mut)]
    pub author: Signer<'info>,

    pub system_program: Program<'info, System>,
}
\`\`\`

### PDA Derivation
\`\`\`rust
// Deriving PDAs with seeds
let (pda, bump) = Pubkey::find_program_address(
    &[b"vault", user.key().as_ref()],
    program_id,
);

// In Anchor — use seeds + bump in account macro
#[account(
    seeds = [b"vault", user.key().as_ref()],
    bump = vault.bump,
)]
pub vault: Account<'info, Vault>,
\`\`\`

### CPI (Cross-Program Invocation)
\`\`\`rust
// Transfer SOL via CPI
let cpi_context = CpiContext::new(
    ctx.accounts.system_program.to_account_info(),
    system_program::Transfer {
        from: ctx.accounts.user.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
    },
);
system_program::transfer(cpi_context, amount)?;

// CPI with PDA signer
let seeds = &[b"vault", user.as_ref(), &[bump]];
let signer_seeds = &[&seeds[..]];
let cpi_ctx = CpiContext::new_with_signer(program, accounts, signer_seeds);
\`\`\`

### Error Handling
\`\`\`rust
#[error_code]
pub enum AppError {
    #[msg("Insufficient funds for withdrawal")]
    InsufficientFunds,
    #[msg("Post title exceeds maximum length")]
    TitleTooLong,
    #[msg("Unauthorized: signer is not the owner")]
    Unauthorized,
}

// Usage
require!(amount <= vault.balance, AppError::InsufficientFunds);
\`\`\`

## Conventions
- Always validate account ownership and signer status
- Store bump in account data to avoid recomputation
- Use \`require!\` macro for readable checks
- Close accounts to reclaim rent when no longer needed
- Use checked math: \`checked_add\`, \`checked_mul\`, \`checked_sub\`

## Anti-Patterns
- Missing signer check on authority accounts
- Missing owner check on deserialized accounts
- Unchecked arithmetic (overflow/underflow)
- Hardcoded program IDs (use declared_id!)
- Not validating PDA seeds (allows account substitution)
- Forgetting to close accounts (rent leak)

## References
- [Anchor Book](https://www.anchor-lang.com/)
- [Solana Cookbook](https://solanacookbook.com/)
- [Anchor Examples](https://github.com/coral-xyz/anchor/tree/master/examples)
`;

const SKILL_SOLANA_SECURITY = `# Solana Security

## Description
Common Solana vulnerabilities and how to prevent them.

## Patterns

### Missing Signer Check
\`\`\`rust
// ❌ Bad: anyone can call this
pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    // No check that ctx.accounts.authority signed the transaction
}

// ✅ Good: Anchor enforces via Signer type
#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut, has_one = authority)]
    pub vault: Account<'info, Vault>,
    pub authority: Signer<'info>,  // Must sign
}
\`\`\`

### Missing Owner Check
\`\`\`rust
// ❌ Bad: account could belong to different program
let account_data = Account::try_from(&account_info)?;

// ✅ Good: Anchor's Account<> type checks owner automatically
pub vault: Account<'info, Vault>,  // Verifies owner == program_id
\`\`\`

### Arithmetic Overflow
\`\`\`rust
// ❌ Bad: can overflow silently
let total = price * quantity;

// ✅ Good: checked arithmetic
let total = price
    .checked_mul(quantity)
    .ok_or(AppError::Overflow)?;
\`\`\`

### PDA Validation
\`\`\`rust
// ❌ Bad: accepting arbitrary account without verifying PDA
pub vault: AccountInfo<'info>,

// ✅ Good: verify PDA derivation
#[account(
    seeds = [b"vault", user.key().as_ref()],
    bump = vault.bump,
)]
pub vault: Account<'info, Vault>,
\`\`\`

### Account Reinitialization
\`\`\`rust
// ✅ Add is_initialized check or use Anchor's init constraint
#[account(
    init,  // Fails if account already exists
    payer = user,
    space = 8 + Data::INIT_SPACE,
)]
pub data: Account<'info, Data>,
\`\`\`

### Closing Accounts Safely
\`\`\`rust
#[account(
    mut,
    close = receiver,  // Transfers lamports and zeros data
    has_one = authority,
)]
pub account_to_close: Account<'info, MyAccount>,
pub receiver: SystemAccount<'info>,
pub authority: Signer<'info>,
\`\`\`

## Anti-Patterns
- Using \`AccountInfo\` when \`Account<T>\` would validate automatically
- Trusting account data without verifying the program owner
- Integer arithmetic without overflow checks
- Not closing unused accounts (permanent rent cost)
- Accepting arbitrary bump seeds from instruction data

## References
- [Sealevel Attacks](https://github.com/coral-xyz/sealevel-attacks)
- [Neodyme Blog](https://blog.neodyme.io/)
- [Anchor Security](https://www.anchor-lang.com/docs/security)
`;

const SKILL_DOCKER = `# Docker Patterns

## Description
Multi-stage builds, layer caching, security, and Docker Compose patterns.

## Patterns

### Multi-Stage Build (Node.js)
\`\`\`dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine
WORKDIR /app
RUN addgroup -g 1001 app && adduser -u 1001 -G app -s /bin/sh -D app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
USER app
EXPOSE 3000
CMD ["node", "dist/index.js"]
\`\`\`

### Layer Caching
\`\`\`dockerfile
# ✅ Copy dependency files first (cached unless deps change)
COPY package*.json ./
RUN npm ci
# Then copy source (changes frequently)
COPY . .
\`\`\`

### Docker Compose
\`\`\`yaml
services:
  app:
    build: .
    ports: ["3000:3000"]
    environment:
      DATABASE_URL: postgres://user:pass@db:5432/app
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: app
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user"]
      interval: 5s
      retries: 5

volumes:
  pgdata:
\`\`\`

## Conventions
- Use specific image tags, not \`latest\`
- Run as non-root user
- Use \`.dockerignore\` to exclude node_modules, .git, etc.
- One process per container
- Use health checks

## Anti-Patterns
- Running as root
- Using \`latest\` tag in production
- Storing secrets in Dockerfile or image layers
- Installing dev dependencies in production image
- Not using .dockerignore (huge context)

## References
- [Dockerfile Best Practices](https://docs.docker.com/develop/develop-images/dockerfile_best-practices/)
- [Docker Compose](https://docs.docker.com/compose/)
`;

const SKILL_TEST_COVERAGE = `# Test Coverage

## Description
Coverage targets, the testing pyramid, and what to test.

## Patterns

### Testing Pyramid
\`\`\`
        /  E2E  \\         Few, slow, expensive
       /─────────\\
      / Integration\\      Some, moderate speed
     /──────────────\\
    /   Unit Tests   \\    Many, fast, cheap
   /──────────────────\\
\`\`\`

### What to Test
| Layer | What | Coverage Target |
|-------|------|----------------|
| Unit | Pure functions, business logic | 80-90% |
| Integration | API endpoints, DB queries | 60-70% |
| E2E | Critical user flows | Key paths only |

### What NOT to Test
- Third-party library internals
- Simple data objects with no logic
- Generated code (GraphQL types, Prisma client)
- Configuration files
- Implementation details (private methods)

### Coverage Commands
\`\`\`bash
# JavaScript/TypeScript
npx vitest run --coverage
npx jest --coverage

# Rust
cargo tarpaulin --out Html

# Python
pytest --cov=src --cov-report=html

# Go
go test -coverprofile=coverage.out ./...
go tool cover -html=coverage.out
\`\`\`

## Conventions
- Track coverage in CI, but don't gate on 100%
- Focus coverage on business logic, not boilerplate
- Untested code should have a reason (documented)
- Review coverage diffs on PRs

## Anti-Patterns
- Chasing 100% coverage (diminishing returns past 85%)
- Testing getters/setters to inflate numbers
- Snapshot tests as sole coverage strategy
- Ignoring flaky tests instead of fixing them

## References
- [Martin Fowler: Test Pyramid](https://martinfowler.com/bliki/TestPyramid.html)
- [Google Testing Blog](https://testing.googleblog.com/)
`;

const SKILL_API = `# API Patterns

## Description
REST API conventions: resource design, error responses, pagination, and auth middleware.

## Patterns

### Resource Design
\`\`\`
GET    /api/users          # List users (paginated)
GET    /api/users/:id      # Get single user
POST   /api/users          # Create user
PATCH  /api/users/:id      # Partial update
DELETE /api/users/:id      # Delete user

# Nested resources
GET    /api/users/:id/posts    # User's posts
POST   /api/users/:id/posts    # Create post for user
\`\`\`

### Error Responses
\`\`\`json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "field": "email", "message": "Invalid email format" },
      { "field": "name", "message": "Required" }
    ]
  }
}
\`\`\`

Status codes:
- 200 OK, 201 Created, 204 No Content
- 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 409 Conflict
- 422 Unprocessable Entity (validation)
- 429 Too Many Requests
- 500 Internal Server Error

### Pagination
\`\`\`
GET /api/users?page=2&limit=20

Response:
{
  "data": [...],
  "pagination": {
    "page": 2,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
\`\`\`

### Auth Middleware
\`\`\`typescript
async function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: { code: 'UNAUTHORIZED' } });

  try {
    const payload = jwt.verify(token, SECRET);
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: { code: 'INVALID_TOKEN' } });
  }
}
\`\`\`

## Conventions
- Use plural nouns for resources (\`/users\` not \`/user\`)
- Use HTTP methods correctly (GET = read, POST = create)
- Always return consistent error format
- Version APIs: \`/api/v1/users\`
- Rate limit all public endpoints

## Anti-Patterns
- Verbs in URLs (\`/getUsers\`) — use HTTP methods
- Returning 200 with error body
- Exposing internal IDs or stack traces
- No pagination on list endpoints
- Inconsistent error formats across endpoints

## References
- [REST API Design](https://restfulapi.net/)
- [HTTP Status Codes](https://httpstatuses.com/)
- [JSON:API Spec](https://jsonapi.org/)
`;

// ─── COMMANDS ──────────────────────────────────────────────

const CMD_COMMIT = `# /commit

## Instruction
Stage changes, write a conventional commit message, and push.

## Steps
1. Run \`git status\` and \`git diff --stat\` to understand changes
2. Group related changes — stage them with \`git add\`
3. Determine the commit type (feat/fix/refactor/etc.) and scope
4. Write a conventional commit message:
   - Subject: \`<type>(<scope>): <imperative summary>\` (max 72 chars)
   - Body (if needed): explain WHY, not what
   - Footer: reference issues (\`Closes #123\`)
5. Commit with \`git commit -m "..."\`
6. Push to current branch

## Rules
- If changes span multiple concerns, make multiple commits
- Never commit secrets, .env files, or build artifacts
- Run lint/typecheck before committing if available
- Use imperative mood: "add" not "added" or "adds"
`;

const CMD_REVIEW = `# /review

## Instruction
Review the current code changes for quality, security, and correctness.

## Steps
1. Run \`git diff\` (or \`git diff --staged\`) to see changes
2. For each changed file, check:
   - **Security**: Input validation, auth checks, no secrets
   - **Correctness**: Edge cases, error handling, null safety
   - **Performance**: N+1 queries, unnecessary loops, memory leaks
   - **Readability**: Clear names, small functions, comments where needed
   - **Tests**: Are changes covered by tests?
3. Output findings in categories:
   - 🔴 Must Fix — blocking issues
   - 🟡 Should Fix — important but not blocking
   - 🟢 Suggestions — nice to have
   - ✅ Good — things done well
4. If no issues found, confirm the code looks good

## Rules
- Always check for hardcoded secrets
- Flag any \`TODO\` or \`FIXME\` without issue links
- Check that error handling is consistent
- Verify new dependencies are necessary
`;

const CMD_TEST = `# /test

## Instruction
Generate tests for recently changed files.

## Steps
1. Run \`git diff --name-only\` to find changed files
2. For each changed source file (skip test files, configs, docs):
   a. Read the file to understand its public API
   b. Identify functions/methods that need tests
   c. Generate tests covering:
      - Happy path (normal inputs)
      - Edge cases (empty, null, boundary values)
      - Error cases (invalid input, failures)
3. Write tests following project conventions:
   - Match existing test file naming pattern
   - Use existing test framework and helpers
   - Follow Arrange-Act-Assert pattern
4. Run the tests to verify they pass

## Rules
- Don't test private/internal implementation details
- Mock external dependencies (network, DB, filesystem)
- Each test should be independent
- Use descriptive test names
- If a test file already exists, add to it rather than replacing
`;

const CMD_FIX = `# /fix

## Instruction
Debug and fix the current issue systematically.

## Steps
1. **Understand**: Read the error message or bug description completely
2. **Reproduce**: Find the minimal steps to trigger the issue
3. **Locate**: Use the error stack trace, \`git log\`, and \`git diff\` to narrow down
4. **Diagnose**: Check:
   - Recent changes that could have introduced this
   - Environment differences (config, versions, env vars)
   - Related code for similar patterns
5. **Fix**: Make the smallest change that fixes the issue
6. **Verify**: Run the relevant tests, and manually verify if needed
7. **Prevent**: Add a test that would have caught this bug

## Rules
- Change ONE thing at a time
- Don't fix symptoms — find the root cause
- If the fix is unclear after 10 minutes, step back and reconsider assumptions
- Document what caused the bug in the commit message
- Always add a regression test
`;

// ─── MAIN FUNCTION ─────────────────────────────────────────

export function getTemplates(stack: StackInfo): Templates {
  // Agents — always all 4 base agents
  const agents: Record<string, string> = {
    'research-web.md': agentResearchWeb(stack),
    'commit-manager.md': agentCommitManager(stack),
    'tester.md': agentTester(stack),
    'reviewer.md': agentReviewer(stack),
  };

  // Domain-specific agents (auto-detected from stack signals)
  for (const da of getDomainAgents(stack)) {
    agents[`${da.name}.md`] = da.content;
  }

  // Skills — always include core 4
  const skills: Record<string, string> = {
    'git-workflow': SKILL_GIT_WORKFLOW,
    'security-scan': SKILL_SECURITY_SCAN,
    'quality-gate': SKILL_QUALITY_GATE,
    'debugging-patterns': SKILL_DEBUGGING,
  };

  // Conditional skills
  if (has(stack, 'rust')) skills['rust-patterns'] = SKILL_RUST;
  if (has(stack, 'typescript', 'javascript')) skills['typescript-strict'] = SKILL_TYPESCRIPT;
  if (has(stack, 'react')) skills['react-patterns'] = SKILL_REACT;
  if (has(stack, 'next')) skills['nextjs-app-router'] = SKILL_NEXTJS;
  if (has(stack, 'python')) skills['python-patterns'] = SKILL_PYTHON;
  if (has(stack, 'go', 'golang')) skills['go-patterns'] = SKILL_GO;
  if (has(stack, 'anchor')) skills['anchor-patterns'] = SKILL_ANCHOR;
  if (has(stack, 'solana')) skills['solana-security'] = SKILL_SOLANA_SECURITY;
  if (has(stack, 'docker')) skills['docker-patterns'] = SKILL_DOCKER;
  if (has(stack, 'vitest', 'jest', 'pytest', 'cargo')) skills['test-coverage'] = SKILL_TEST_COVERAGE;
  if (has(stack, 'express', 'fastify', 'fastapi', 'flask', 'gin', 'actix', 'axum')) skills['api-patterns'] = SKILL_API;

  // Commands — always all 4
  const commands: Record<string, string> = {
    'commit.md': CMD_COMMIT,
    'review.md': CMD_REVIEW,
    'test.md': CMD_TEST,
    'fix.md': CMD_FIX,
  };

  // Settings
  const settings = {
    model: 'anthropic/claude-sonnet-4-20250514',
    thinking: 'low',
    heartbeat: false,
  };

  // Config
  const config = {
    name: stack.runtime || 'project',
    version: '1.0.0',
    stack: {
      languages: stack.languages,
      frameworks: stack.frameworks,
      buildTools: stack.buildTools,
      testing: stack.testing,
      database: stack.database,
      runtime: stack.runtime,
    },
  };

  return { agents, skills, commands, settings, config };
}
