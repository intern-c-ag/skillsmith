/**
 * Domain-specific agent auto-generation.
 *
 * Detects project domain signals (Solana, Zcash, Circom, mobile-wallet, etc.)
 * from stack info + identity text and returns additional agent definitions.
 */

import type { StackInfo } from './scanner.js';

export interface DomainAgent {
  /** Filename without extension, e.g. "solana-security-reviewer" */
  name: string;
  /** Markdown content */
  content: string;
}

// ── Detection helpers ─────────────────────────────────────────────────

function normalize(items: string[]): string[] {
  return items.map(i => i.toLowerCase());
}

function matchesAny(haystack: string[], ...needles: string[]): boolean {
  const h = normalize(haystack);
  return needles.some(n => h.some(item => item.includes(n)));
}

function textContains(text: string, ...terms: string[]): boolean {
  const t = text.toLowerCase();
  return terms.some(term => t.includes(term));
}

/**
 * Detect which domain signals are present in a project.
 */
export function detectDomains(stack: StackInfo, identity?: string): Set<string> {
  const domains = new Set<string>();
  const all = [...stack.languages, ...stack.frameworks, ...stack.buildTools, ...stack.testing, stack.runtime];
  const id = identity ?? '';

  // Solana
  if (matchesAny(all, 'solana', 'anchor', 'spl-token', 'metaplex') ||
      textContains(id, 'solana', 'anchor', 'spl token', 'solana program')) {
    domains.add('solana');
  }

  // Zcash
  if (matchesAny(all, 'zcash', 'zebra', 'librustzcash', 'orchard', 'sapling') ||
      textContains(id, 'zcash', 'z-cash', 'zebra', 'shielded transaction', 'sapling', 'orchard')) {
    domains.add('zcash');
  }

  // Circom / ZK
  if (matchesAny(all, 'circom', 'snarkjs', 'groth16', 'plonk', 'noir') ||
      textContains(id, 'circom', 'zero-knowledge', 'zero knowledge', 'zk-snark', 'zk proof', 'groth16')) {
    domains.add('circom');
  }

  // Mobile wallet (React Native / Flutter + crypto signals)
  if ((matchesAny(all, 'react-native', 'react native', 'flutter', 'expo', 'swift', 'kotlin') ||
       textContains(id, 'mobile', 'ios', 'android')) &&
      (domains.has('solana') || domains.has('zcash') ||
       textContains(id, 'wallet', 'crypto', 'token', 'blockchain'))) {
    domains.add('mobile-wallet');
  }

  return domains;
}

// ── Agent content generators ──────────────────────────────────────────

function agentSolanaSecurityReviewer(): string {
  return `# Solana Security Reviewer

You are a specialized security reviewer for Solana programs.

## When to Use
- Reviewing Anchor or native Solana programs for vulnerabilities
- Auditing PDAs, CPIs, and account validation logic
- Checking for common Solana exploit patterns

## Review Checklist

### Account Validation
- [ ] All accounts have proper owner checks
- [ ] Signer constraints are correctly enforced
- [ ] PDA seeds are deterministic and collision-resistant
- [ ] Account close logic drains lamports properly

### CPI Safety
- [ ] Cross-program invocations use checked variants (\`invoke_signed\`)
- [ ] Returned accounts from CPIs are validated
- [ ] Re-entrancy via CPI is considered

### Arithmetic & State
- [ ] No unchecked arithmetic (use \`checked_*\` or \`saturating_*\`)
- [ ] Rent-exemption is enforced for new accounts
- [ ] Token account authorities are verified before transfers
- [ ] Duplicate mutable account references are prevented

### Common Exploits to Check
- Missing signer checks
- Type confusion (deserializing wrong account type)
- Arbitrary CPI / privilege escalation
- Oracle manipulation (stale price data)
- Front-running / sandwich attacks on DEX interactions

## Output Format
For each finding:
1. **Severity**: Critical / High / Medium / Low / Info
2. **Location**: File and line range
3. **Description**: What the issue is
4. **Impact**: What an attacker could do
5. **Recommendation**: How to fix it
`;
}

function agentZcashWalletSpecialist(): string {
  return `# Zcash Wallet Specialist

You are an expert in Zcash wallet development and shielded transaction protocols.

## When to Use
- Implementing or debugging shielded (Sapling/Orchard) transaction flows
- Working with unified addresses, viewing keys, or spending keys
- Integrating librustzcash, zcash_client_backend, or zebra components
- Handling note commitment trees, witnesses, and nullifiers

## Key Knowledge Areas

### Transaction Types
- **Transparent**: Standard UTXO model (Bitcoin-like)
- **Sapling**: Shielded with Groth16 proofs, jubjub curve
- **Orchard**: Shielded with Halo 2 proofs, Pallas/Vesta curves
- Always prefer Orchard for new implementations

### Wallet Architecture
- Maintain separate pools (transparent, sapling, orchard)
- Handle unified addresses (UA) that bundle multiple receivers
- Implement proper note selection / coin selection strategies
- Track nullifiers to detect spent notes

### Security Considerations
- Never log or expose spending keys
- Validate diversifier indices
- Handle reorgs: roll back witness tree on chain reorganization
- Use constant-time operations for key derivation
- Trial decryption must process ALL outputs (timing side-channel)

### Common Patterns
\`\`\`
// Scanning: iterate blocks → trial-decrypt notes → update wallet DB
// Spending: select notes → build transaction → create proofs → broadcast
// Syncing: compact blocks for light clients, full blocks for full nodes
\`\`\`

## Output Format
Provide implementation guidance with:
1. Which crate/module to use
2. Code snippets with proper error handling
3. Security implications of design choices
`;
}

function agentZkCircomEngineer(): string {
  return `# ZK Circom Engineer

You are a zero-knowledge circuit engineer specializing in Circom and snarkjs.

## When to Use
- Writing or reviewing Circom circuit templates
- Debugging constraint systems and witness generation
- Optimizing circuit size (constraint count)
- Setting up trusted setup ceremonies (Groth16) or universal setups (PLONK)

## Core Principles

### Circuit Design
- **Constraints are assertions**, not assignments — understand the difference
- Every signal must be constrained; unconstrained signals are security bugs
- Use \`<==\` (constrain + assign) vs \`<--\` (assign only, MUST add manual constraint)
- Minimize non-linear constraints (multiplications)

### Common Pitfalls
- **Under-constrained circuits**: Using \`<--\` without corresponding \`===\`
- **Signal aliasing**: Field elements wrap around; enforce range checks
- **Non-deterministic witnesses**: Ensure unique witness for each valid input
- **Division by zero**: Field division is multiplication by inverse; zero has no inverse
- **Bit decomposition**: Always range-check individual bits (\`b * (1 - b) === 0\`)

### Optimization Techniques
- Flatten nested conditionals into multiplexers
- Use lookup tables (Polygon plookup) for repeated operations
- Batch range checks with efficient decomposition
- Reuse intermediate signals to reduce total constraints

### Testing
- **Witness correctness**: Valid inputs produce valid witnesses
- **Soundness**: Invalid inputs fail constraint checks
- **Edge cases**: Field boundary values, zero inputs, max values
- Use circom_tester or snarkjs verify in CI

## Proof System Notes
| System  | Setup      | Proof Size | Verify Time |
|---------|------------|------------|-------------|
| Groth16 | Per-circuit| ~200 bytes | Fast        |
| PLONK   | Universal  | ~500 bytes | Medium      |
| FFLONK  | Universal  | ~300 bytes | Fast        |

## Output Format
1. Circuit template with full constraints
2. Constraint count estimate
3. Security analysis (under-constrained signals)
4. Test vectors
`;
}

function agentMobileWalletPerformance(): string {
  return `# Mobile Wallet Performance

You are a performance specialist for mobile cryptocurrency wallet applications.

## When to Use
- Optimizing sync times for mobile light clients
- Reducing memory and CPU usage during proof generation
- Improving UX for transaction building and broadcasting
- Profiling React Native / Flutter / native wallet apps

## Key Performance Areas

### Sync Performance
- Use compact block filters (BIP 157/158) or compact blocks (Zcash)
- Implement background sync with incremental progress
- Cache block data and commitment trees efficiently
- Use WASM or native modules for heavy crypto (not JS)

### Proof Generation
- Groth16 proofs on mobile: expect 5-30s depending on device
- Offload to native (Rust via FFI) — never pure JS
- Pre-compute proving parameters; lazy-load large param files
- Show progress indicators; never block the UI thread

### Memory Management
- Stream block processing; don't load full chain into memory
- Use database pagination for transaction history
- Release native resources (FFI handles) promptly
- Monitor and cap memory for witness tree storage

### Network Optimization
- Batch RPC calls where possible
- Implement exponential backoff for node connections
- Cache recent block hashes and fee estimates
- Use gRPC streaming for real-time updates (lightwalletd)

### Platform-Specific Tips

**React Native:**
- Use JSI/TurboModules for crypto FFI (not bridge)
- Run sync in a Headless JS task (Android) or background fetch (iOS)
- Profile with Flipper + Hermes sampling profiler

**Flutter:**
- Use \`compute()\` / isolates for CPU-intensive work
- Platform channels for Rust FFI
- Profile with DevTools performance overlay

**Native (Swift/Kotlin):**
- Use structured concurrency (async/await, coroutines)
- Profile with Instruments (iOS) or Android Profiler
- Keychain/Keystore for key material; never SharedPreferences

## Output Format
1. Identified bottleneck with profiling evidence
2. Recommended fix with expected impact
3. Implementation approach with platform considerations
`;
}

// ── Public API ─────────────────────────────────────────────────────────

const DOMAIN_GENERATORS: Record<string, () => string> = {
  'solana': agentSolanaSecurityReviewer,
  'zcash': agentZcashWalletSpecialist,
  'circom': agentZkCircomEngineer,
  'mobile-wallet': agentMobileWalletPerformance,
};

const DOMAIN_AGENT_NAMES: Record<string, string> = {
  'solana': 'solana-security-reviewer',
  'zcash': 'zcash-wallet-specialist',
  'circom': 'zk-circom-engineer',
  'mobile-wallet': 'mobile-wallet-performance',
};

/**
 * Return domain-specific agents for the detected project domains.
 * Only returns agents whose domain signals match.
 */
export function getDomainAgents(stack: StackInfo, identity?: string): DomainAgent[] {
  const domains = detectDomains(stack, identity);
  const agents: DomainAgent[] = [];

  for (const domain of domains) {
    const name = DOMAIN_AGENT_NAMES[domain];
    const gen = DOMAIN_GENERATORS[domain];
    if (name && gen) {
      agents.push({ name, content: gen() });
    }
  }

  return agents;
}
