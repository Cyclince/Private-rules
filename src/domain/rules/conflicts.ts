import type { DomainRule, DomainRuleType, RuleConflict } from '../../types/domain-rules';

export type ConflictIndexedRule = {
  id: string;
  categoryId: string;
  categoryName: string;
  type: DomainRuleType;
  value: string;
};

type InternalRule = ConflictIndexedRule & {
  lowerValue: string;
  order: number;
};

type ComparableRule = Pick<DomainRule, 'type' | 'value'>;

const DOMAIN_TYPES = new Set<DomainRuleType>(['DOMAIN', 'DOMAIN-SUFFIX']);
const SEARCHABLE_TYPES = new Set<DomainRuleType>(['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD']);
const NETWORK_TYPES = new Set<DomainRuleType>(['IP-CIDR', 'SRC-IP-CIDR']);
const PORT_TYPES = new Set<DomainRuleType>(['DST-PORT', 'SRC-PORT']);

function ipv4Value(value: string): bigint | null {
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((result, part) => (result << 8n) | BigInt(part), 0n);
}

function ipv6Value(value: string): bigint | null {
  if (!value.includes(':') || (value.match(/::/g)?.length ?? 0) > 1) return null;
  const [left = '', right = ''] = value.split('::');
  const leftParts = left ? left.split(':') : [];
  const rightParts = right ? right.split(':') : [];
  const missing = 8 - leftParts.length - rightParts.length;
  if (missing < (value.includes('::') ? 1 : 0)) return null;
  const parts = value.includes('::') ? [...leftParts, ...Array<string>(missing).fill('0'), ...rightParts] : leftParts;
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return null;
  return parts.reduce((result, part) => (result << 16n) | BigInt(`0x${part}`), 0n);
}

export function parseCidrRange(value: string): { ipv6: boolean; start: bigint; end: bigint } | null {
  const [address, prefixText] = value.split('/');
  if (!address || prefixText === undefined) return null;
  const ipv6 = address.includes(':');
  const bits = ipv6 ? 128 : 32;
  const prefix = Number(prefixText);
  const numeric = ipv6 ? ipv6Value(address) : ipv4Value(address);
  if (numeric === null || !Number.isInteger(prefix) || prefix < 0 || prefix > bits) return null;
  const hostBits = BigInt(bits - prefix);
  const start = hostBits === BigInt(bits) ? 0n : (numeric >> hostBits) << hostBits;
  const end = start + (1n << hostBits) - 1n;
  return { ipv6, start, end };
}

function parsePortRange(value: string): { start: number; end: number } | null {
  const [startText, endText = startText] = value.split('-');
  const start = Number(startText);
  const end = Number(endText);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end };
}

function domainRulesOverlap(left: ComparableRule, right: ComparableRule): boolean {
  if (!DOMAIN_TYPES.has(left.type) || !DOMAIN_TYPES.has(right.type)) return false;
  if (left.value === right.value) return true;
  if (left.type === 'DOMAIN-SUFFIX' && right.value.endsWith(`.${left.value}`)) return true;
  if (right.type === 'DOMAIN-SUFFIX' && left.value.endsWith(`.${right.value}`)) return true;
  return false;
}

function keywordRulesOverlap(left: ComparableRule, right: ComparableRule): boolean {
  if (!SEARCHABLE_TYPES.has(left.type) || !SEARCHABLE_TYPES.has(right.type)) return false;
  if (left.type === 'DOMAIN-KEYWORD' && right.value.includes(left.value)) return true;
  if (right.type === 'DOMAIN-KEYWORD' && left.value.includes(right.value)) return true;
  return false;
}

function networkRulesOverlap(left: ComparableRule, right: ComparableRule): boolean {
  if (left.type !== right.type || !NETWORK_TYPES.has(left.type)) return false;
  const leftRange = parseCidrRange(left.value);
  const rightRange = parseCidrRange(right.value);
  return Boolean(
    leftRange &&
    rightRange &&
    leftRange.ipv6 === rightRange.ipv6 &&
    leftRange.start <= rightRange.end &&
    rightRange.start <= leftRange.end,
  );
}

function portRulesOverlap(left: ComparableRule, right: ComparableRule): boolean {
  if (left.type !== right.type || !PORT_TYPES.has(left.type)) return false;
  const leftRange = parsePortRange(left.value);
  const rightRange = parsePortRange(right.value);
  return Boolean(leftRange && rightRange && leftRange.start <= rightRange.end && rightRange.start <= leftRange.end);
}

export function overlapReason(left: ComparableRule, right: ComparableRule): string | null {
  if (keywordRulesOverlap(left, right)) return '关键词规则会覆盖另一条规则的匹配范围';
  if (domainRulesOverlap(left, right)) return '域名或后缀的匹配范围互相包含';
  if (networkRulesOverlap(left, right)) return 'IP 网段的匹配范围互相包含或重叠';
  if (portRulesOverlap(left, right)) {
    return `${left.type === 'SRC-PORT' ? '来源' : '目标'}端口的匹配范围互相包含或重叠`;
  }
  return null;
}

/**
 * Reference O(N) conflict scan kept as a pure function for differential
 * verification against `RuleConflictIndex`.
 */
export function findRuleConflictsLinear(
  existingRules: readonly ConflictIndexedRule[],
  candidate: ComparableRule,
  excludeRuleId?: string,
): RuleConflict[] {
  const next = { type: candidate.type, value: candidate.value.toLowerCase() };
  const results: RuleConflict[] = [];
  for (const row of existingRules) {
    if (row.id === excludeRuleId) continue;
    const existing = { type: row.type, value: row.value.toLowerCase() };
    const duplicate = existing.type === next.type && existing.value === next.value;
    const reason = duplicate ? '规则类型和值完全相同' : overlapReason(existing, next);
    if (!reason) continue;
    results.push({
      id: row.id,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      value: row.value,
      type: row.type,
      kind: duplicate ? 'duplicate' : 'conflict',
      reason,
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Reversed-label suffix trie for DOMAIN and DOMAIN-SUFFIX rules
// ---------------------------------------------------------------------------

type SuffixTrieNode = {
  children: Map<string, SuffixTrieNode>;
  exactDomainRules: InternalRule[];
  suffixRules: InternalRule[];
};

function createTrieNode(): SuffixTrieNode {
  return { children: new Map(), exactDomainRules: [], suffixRules: [] };
}

function collectSubtreeRules(node: SuffixTrieNode, out: Map<string, InternalRule>) {
  for (const rule of node.exactDomainRules) out.set(rule.id, rule);
  for (const rule of node.suffixRules) out.set(rule.id, rule);
  for (const child of node.children.values()) collectSubtreeRules(child, out);
}

// ---------------------------------------------------------------------------
// Augmented balanced static interval tree (O(log n + k) overlap queries)
// ---------------------------------------------------------------------------

type IntervalEntry<T extends bigint | number> = {
  start: T;
  end: T;
  rule: InternalRule;
};

type IntervalNode<T extends bigint | number> = {
  entry: IntervalEntry<T>;
  maxEnd: T;
  left: IntervalNode<T> | null;
  right: IntervalNode<T> | null;
};

function buildIntervalTree<T extends bigint | number>(entries: IntervalEntry<T>[]): IntervalNode<T> | null {
  if (entries.length === 0) return null;
  const sorted = [...entries].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  const build = (lo: number, hi: number): IntervalNode<T> | null => {
    if (lo > hi) return null;
    const mid = (lo + hi) >>> 1;
    const left = build(lo, mid - 1);
    const right = build(mid + 1, hi);
    const entry = sorted[mid];
    let maxEnd = entry.end;
    if (left && left.maxEnd > maxEnd) maxEnd = left.maxEnd;
    if (right && right.maxEnd > maxEnd) maxEnd = right.maxEnd;
    return { entry, maxEnd, left, right };
  };

  return build(0, sorted.length - 1);
}

function queryIntervalTree<T extends bigint | number>(
  node: IntervalNode<T> | null,
  qStart: T,
  qEnd: T,
  out: Map<string, InternalRule>,
) {
  if (!node) return;
  if (node.left && node.left.maxEnd >= qStart) {
    queryIntervalTree(node.left, qStart, qEnd, out);
  }
  if (node.entry.start <= qEnd && qStart <= node.entry.end) {
    out.set(node.entry.rule.id, node.entry.rule);
  }
  if (node.right && node.entry.start <= qEnd) {
    queryIntervalTree(node.right, qStart, qEnd, out);
  }
}

// ---------------------------------------------------------------------------
// Aho-Corasick automaton for O(|text| + k) multi-keyword substring matching
// ---------------------------------------------------------------------------

type AcNode = {
  next: Map<string, number>;
  fail: number;
  outputs: InternalRule[];
};

class KeywordAutomaton {
  private readonly nodes: AcNode[] = [{ next: new Map(), fail: 0, outputs: [] }];

  constructor(keywordRules: readonly InternalRule[]) {
    for (const rule of keywordRules) {
      let state = 0;
      for (const ch of rule.lowerValue) {
        let nextState = this.nodes[state].next.get(ch);
        if (nextState === undefined) {
          nextState = this.nodes.length;
          this.nodes.push({ next: new Map(), fail: 0, outputs: [] });
          this.nodes[state].next.set(ch, nextState);
        }
        state = nextState;
      }
      this.nodes[state].outputs.push(rule);
    }

    const queue: number[] = [];
    for (const nextState of this.nodes[0].next.values()) {
      this.nodes[nextState].fail = 0;
      queue.push(nextState);
    }
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      for (const [ch, target] of this.nodes[current].next) {
        let fallback = this.nodes[current].fail;
        while (fallback !== 0 && !this.nodes[fallback].next.has(ch)) {
          fallback = this.nodes[fallback].fail;
        }
        const failState = this.nodes[fallback].next.get(ch) ?? 0;
        this.nodes[target].fail = failState;
        if (this.nodes[failState].outputs.length > 0) {
          this.nodes[target].outputs.push(...this.nodes[failState].outputs);
        }
        queue.push(target);
      }
    }
  }

  matchAll(text: string, out: Map<string, InternalRule>) {
    if (this.nodes.length <= 1) return;
    let state = 0;
    for (const ch of text) {
      while (state !== 0 && !this.nodes[state].next.has(ch)) {
        state = this.nodes[state].fail;
      }
      state = this.nodes[state].next.get(ch) ?? 0;
      const outputs = this.nodes[state].outputs;
      for (let i = 0; i < outputs.length; i += 1) {
        out.set(outputs[i].id, outputs[i]);
      }
    }
  }
}

/**
 * In-memory indexed conflict detector (design §9.3) using:
 *   - Exact hash map (`type:value`) for O(1) duplicate lookups
 *   - Reversed-label suffix trie for O(labels) domain/suffix overlap lookups
 *   - Balanced augmented interval trees for O(log n + k) CIDR (v4/v6) and port range overlaps
 *   - Aho-Corasick automaton + trigram posting index for keyword overlap lookups
 */
export class RuleConflictIndex {
  private readonly exactByKey = new Map<string, InternalRule[]>();
  private readonly domainTrie = createTrieNode();
  private readonly ipv4Trees: Record<'IP-CIDR' | 'SRC-IP-CIDR', IntervalNode<bigint> | null>;
  private readonly ipv6Trees: Record<'IP-CIDR' | 'SRC-IP-CIDR', IntervalNode<bigint> | null>;
  private readonly portTrees: Record<'DST-PORT' | 'SRC-PORT', IntervalNode<number> | null>;
  private readonly keywordAutomaton: KeywordAutomaton;
  private readonly searchableRules: InternalRule[] = [];
  private readonly trigramIndex = new Map<string, InternalRule[]>();

  constructor(existingRules: readonly ConflictIndexedRule[]) {
    const ipv4Buckets: Record<'IP-CIDR' | 'SRC-IP-CIDR', IntervalEntry<bigint>[]> = {
      'IP-CIDR': [],
      'SRC-IP-CIDR': [],
    };
    const ipv6Buckets: Record<'IP-CIDR' | 'SRC-IP-CIDR', IntervalEntry<bigint>[]> = {
      'IP-CIDR': [],
      'SRC-IP-CIDR': [],
    };
    const portBuckets: Record<'DST-PORT' | 'SRC-PORT', IntervalEntry<number>[]> = {
      'DST-PORT': [],
      'SRC-PORT': [],
    };
    const keywordRules: InternalRule[] = [];

    existingRules.forEach((raw, order) => {
      const rule: InternalRule = { ...raw, lowerValue: raw.value.toLowerCase(), order };
      const exactKey = `${rule.type}:${rule.lowerValue}`;
      const bucket = this.exactByKey.get(exactKey);
      if (bucket) bucket.push(rule);
      else this.exactByKey.set(exactKey, [rule]);

      if (DOMAIN_TYPES.has(rule.type)) {
        const labels = rule.lowerValue.split('.').reverse();
        let node = this.domainTrie;
        for (const label of labels) {
          let next = node.children.get(label);
          if (!next) {
            next = createTrieNode();
            node.children.set(label, next);
          }
          node = next;
        }
        if (rule.type === 'DOMAIN-SUFFIX') node.suffixRules.push(rule);
        else node.exactDomainRules.push(rule);
      }

      if (SEARCHABLE_TYPES.has(rule.type)) {
        this.searchableRules.push(rule);
        if (rule.lowerValue.length >= 3) {
          const seenGrams = new Set<string>();
          for (let i = 0; i <= rule.lowerValue.length - 3; i += 1) {
            const gram = rule.lowerValue.slice(i, i + 3);
            if (seenGrams.has(gram)) continue;
            seenGrams.add(gram);
            const list = this.trigramIndex.get(gram);
            if (list) list.push(rule);
            else this.trigramIndex.set(gram, [rule]);
          }
        }
      }

      if (rule.type === 'DOMAIN-KEYWORD') {
        keywordRules.push(rule);
      }

      if (rule.type === 'IP-CIDR' || rule.type === 'SRC-IP-CIDR') {
        const range = parseCidrRange(rule.lowerValue);
        if (range) {
          const target = range.ipv6 ? ipv6Buckets[rule.type] : ipv4Buckets[rule.type];
          target.push({ start: range.start, end: range.end, rule });
        }
      }

      if (rule.type === 'DST-PORT' || rule.type === 'SRC-PORT') {
        const range = parsePortRange(rule.lowerValue);
        if (range) {
          portBuckets[rule.type].push({ start: range.start, end: range.end, rule });
        }
      }
    });

    this.ipv4Trees = {
      'IP-CIDR': buildIntervalTree(ipv4Buckets['IP-CIDR']),
      'SRC-IP-CIDR': buildIntervalTree(ipv4Buckets['SRC-IP-CIDR']),
    };
    this.ipv6Trees = {
      'IP-CIDR': buildIntervalTree(ipv6Buckets['IP-CIDR']),
      'SRC-IP-CIDR': buildIntervalTree(ipv6Buckets['SRC-IP-CIDR']),
    };
    this.portTrees = {
      'DST-PORT': buildIntervalTree(portBuckets['DST-PORT']),
      'SRC-PORT': buildIntervalTree(portBuckets['SRC-PORT']),
    };
    this.keywordAutomaton = new KeywordAutomaton(keywordRules);
  }

  findConflicts(candidate: ComparableRule, excludeRuleId?: string): RuleConflict[] {
    const nextValue = candidate.value.toLowerCase();
    const next = { type: candidate.type, value: nextValue };
    const candidates = new Map<string, InternalRule>();

    // 1. Exact type + value duplicates
    for (const rule of this.exactByKey.get(`${next.type}:${nextValue}`) ?? []) {
      candidates.set(rule.id, rule);
    }

    // 2. Domain / suffix overlaps via reversed-label trie
    if (DOMAIN_TYPES.has(next.type)) {
      const labels = nextValue.split('.').reverse();
      let node: SuffixTrieNode | undefined = this.domainTrie;
      for (const label of labels) {
        node = node.children.get(label);
        if (!node) break;
        for (const suffixRule of node.suffixRules) {
          candidates.set(suffixRule.id, suffixRule);
        }
      }
      if (node) {
        // Exact same value across DOMAIN <-> DOMAIN-SUFFIX
        for (const exactRule of node.exactDomainRules) candidates.set(exactRule.id, exactRule);
        if (next.type === 'DOMAIN-SUFFIX') {
          // Every existing DOMAIN or DOMAIN-SUFFIX under this suffix subtree
          for (const child of node.children.values()) collectSubtreeRules(child, candidates);
        }
      }
    }

    // 3. Keyword overlaps (both directions)
    if (SEARCHABLE_TYPES.has(next.type)) {
      // Existing DOMAIN-KEYWORD values contained inside candidate value
      this.keywordAutomaton.matchAll(nextValue, candidates);

      // Candidate DOMAIN-KEYWORD contained inside existing searchable rule values
      if (next.type === 'DOMAIN-KEYWORD') {
        if (nextValue.length >= 3) {
          // Pick the smallest trigram posting list to minimize substring scans
          let smallest: InternalRule[] | undefined;
          for (let i = 0; i <= nextValue.length - 3; i += 1) {
            const list = this.trigramIndex.get(nextValue.slice(i, i + 3));
            if (!list || list.length === 0) {
              smallest = [];
              break;
            }
            if (!smallest || list.length < smallest.length) smallest = list;
          }
          for (const rule of smallest ?? []) {
            if (rule.lowerValue.includes(nextValue)) candidates.set(rule.id, rule);
          }
        } else {
          for (const rule of this.searchableRules) {
            if (rule.lowerValue.includes(nextValue)) candidates.set(rule.id, rule);
          }
        }
      }
    }

    // 4. CIDR interval overlaps (IPv4 / IPv6)
    if (next.type === 'IP-CIDR' || next.type === 'SRC-IP-CIDR') {
      const range = parseCidrRange(nextValue);
      if (range) {
        const tree = range.ipv6 ? this.ipv6Trees[next.type] : this.ipv4Trees[next.type];
        queryIntervalTree(tree, range.start, range.end, candidates);
      }
    }

    // 5. Port interval overlaps
    if (next.type === 'DST-PORT' || next.type === 'SRC-PORT') {
      const range = parsePortRange(nextValue);
      if (range) {
        queryIntervalTree(this.portTrees[next.type], range.start, range.end, candidates);
      }
    }

    // Materialize in original insertion order with exact legacy reason semantics
    const ordered = [...candidates.values()].sort((a, b) => a.order - b.order);
    const conflicts: RuleConflict[] = [];
    for (const row of ordered) {
      if (row.id === excludeRuleId) continue;
      const existing = { type: row.type, value: row.lowerValue };
      const duplicate = existing.type === next.type && existing.value === next.value;
      const reason = duplicate ? '规则类型和值完全相同' : overlapReason(existing, next);
      if (!reason) continue;
      conflicts.push({
        id: row.id,
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        value: row.value,
        type: row.type,
        kind: duplicate ? 'duplicate' : 'conflict',
        reason,
      });
    }
    return conflicts;
  }
}
