import { validatePortfolio } from "./science-invariants.mjs";

function chooseBigInt(n, k) {
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || k > n) return 0n;
  k = Math.min(k, n - k);
  let out = 1n;
  for (let i = 1; i <= k; i += 1) {
    out = (out * BigInt(n - k + i)) / BigInt(i);
  }
  return out;
}

function bitCount(value) {
  let x = value >>> 0;
  let count = 0;
  while (x) {
    x &= x - 1;
    count += 1;
  }
  return count;
}

function fourSubsets(ticket) {
  return ticket.map((_, omitted) => ticket.filter((__, i) => i !== omitted).slice().sort((a, b) => a - b));
}

export function portfolioGeometry(tickets) {
  validatePortfolio(tickets, 0, 0);
  const usage = new Map();
  const fourKeys = [];

  for (const ticket of tickets) {
    for (const n of ticket) usage.set(n, (usage.get(n) ?? 0) + 1);
    for (const subset of fourSubsets(ticket)) fourKeys.push(subset.join("-"));
  }

  let maxPairwiseOverlap = 0;
  for (let i = 0; i < tickets.length; i += 1) {
    for (let j = i + 1; j < tickets.length; j += 1) {
      const b = new Set(tickets[j]);
      const overlap = tickets[i].filter((n) => b.has(n)).length;
      maxPairwiseOverlap = Math.max(maxPairwiseOverlap, overlap);
    }
  }

  const usages = [...usage.values()];
  const uniqueFour = new Set(fourKeys);
  return {
    uniqueNumbers: usage.size,
    uniqueFourSubsets: uniqueFour.size,
    duplicateFourSubsets: fourKeys.length - uniqueFour.size,
    maxPairwiseOverlap,
    minNumberUsage: Math.min(...usages),
    maxNumberUsage: Math.max(...usages),
  };
}

export function exactNullPortfolioMetrics(tickets, { universeSize = 100, drawn = 10 } = {}) {
  validatePortfolio(tickets, 0, 0);
  const union = [...new Set(tickets.flat())].sort((a, b) => a - b);
  if (union.length > 20) {
    throw new Error("exact union enumeration is intentionally capped at 20 unique numbers");
  }

  const index = new Map(union.map((n, i) => [n, i]));
  const ticketMasks = tickets.map((ticket) => ticket.reduce((mask, n) => mask | (1 << index.get(n)), 0));
  const total = chooseBigInt(universeSize, drawn);
  let ge3 = 0n;
  let ge4 = 0n;
  let ge5 = 0n;
  let multiple4 = 0n;
  let expected4plusNumerator = 0n;

  const states = 1 << union.length;
  for (let mask = 0; mask < states; mask += 1) {
    const selectedInside = bitCount(mask);
    const selectedOutside = drawn - selectedInside;
    if (selectedOutside < 0 || selectedOutside > universeSize - union.length) continue;

    const ways = chooseBigInt(universeSize - union.length, selectedOutside);
    if (ways === 0n) continue;
    const hits = ticketMasks.map((ticketMask) => bitCount(mask & ticketMask));
    const maxHits = Math.max(...hits);
    const count4plus = hits.filter((h) => h >= 4).length;

    if (maxHits >= 3) ge3 += ways;
    if (maxHits >= 4) ge4 += ways;
    if (maxHits >= 5) ge5 += ways;
    if (count4plus >= 2) multiple4 += ways;
    expected4plusNumerator += BigInt(count4plus) * ways;
  }

  const ratio = (n) => Number(n) / Number(total);
  return {
    ...portfolioGeometry(tickets),
    pAtLeast3: ratio(ge3),
    pAtLeast4: ratio(ge4),
    pAtLeast5: ratio(ge5),
    pMultiple4Plus: ratio(multiple4),
    expected4PlusTickets: ratio(expected4plusNumerator),
    oddsAtLeast4: Number(total) / Number(ge4),
    nullModel: `UNIFORM_${drawn}_OF_${universeSize}`,
    calculationMethod: "EXACT_UNION_ENUMERATION_V1",
  };
}

export const K6_EDGE_PAIRS = Object.freeze([
  [0, 1], [0, 2], [0, 3], [0, 4], [0, 5],
  [1, 2], [1, 3], [1, 4], [1, 5],
  [2, 3], [2, 4], [2, 5],
  [3, 4], [3, 5],
  [4, 5],
]);

export function k6EdgePortfolio(edgeLabels) {
  if (!Array.isArray(edgeLabels) || edgeLabels.length !== 15 || new Set(edgeLabels).size !== 15) {
    throw new Error("K6 edge design requires exactly 15 unique labels");
  }
  const tickets = Array.from({ length: 6 }, () => []);
  K6_EDGE_PAIRS.forEach(([a, b], i) => {
    tickets[a].push(edgeLabels[i]);
    tickets[b].push(edgeLabels[i]);
  });
  return tickets.map((ticket) => ticket.sort((a, b) => a - b));
}
