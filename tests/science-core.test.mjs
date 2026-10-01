import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertProspectiveCutoff,
  validateProbabilities,
  validateTicket,
  validatePortfolio,
  assertSha256,
} from "../scripts/science-invariants.mjs";
import { exactNullPortfolioMetrics, portfolioGeometry } from "../scripts/portfolio-math.mjs";

const weighted15 = [
  [2,26,35,45,88],
  [1,35,39,47,85],
  [16,26,27,57,85],
  [1,2,16,41,78],
  [30,39,41,57,88],
  [27,30,45,47,78],
];

const consensus15 = [
  [26,35,41,45,80],
  [16,26,57,81,85],
  [2,27,78,80,81],
  [1,30,41,57,78],
  [1,2,16,45,88],
  [27,30,35,85,88],
];

const random15 = [
  [26,38,56,71,80],
  [3,15,26,32,51],
  [38,43,51,67,79],
  [17,32,43,46,56],
  [15,17,33,79,80],
  [3,33,46,67,71],
];

const wheelPool = [16,26,57,79,85,88];
const wheel6 = wheelPool.map((omit) => wheelPool.filter((n) => n !== omit));

function close(actual, expected, tol = 1e-15) {
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} != ${expected}`);
}

test("DATA-V1 manifest keeps the canonical arithmetic consistent", async () => {
  const raw = await readFile(new URL("../data/data-v1-manifest.json", import.meta.url), "utf8");
  const manifest = JSON.parse(raw);
  assert.equal(manifest.counts.draws, 267);
  assert.equal(manifest.counts.numbers, 2670);
  assert.equal(manifest.counts.numbers, manifest.counts.draws * 10);
  assert.equal(manifest.range.first_draw, 50);
  assert.equal(manifest.range.last_draw, 316);
  assert.equal(manifest.counts.open_conflicts, 1);
});

test("prospective cutoff rejects look-ahead", () => {
  assert.equal(assertProspectiveCutoff(316, 317), true);
  assert.throws(() => assertProspectiveCutoff(317, 317), /look-ahead/);
  assert.throws(() => assertProspectiveCutoff(318, 317), /look-ahead/);
});

test("probability vector represents ten expected selected numbers", () => {
  const uniform = Array(100).fill(0.1);
  assert.equal(validateProbabilities(uniform), true);
  assert.throws(() => validateProbabilities(Array(99).fill(0.1)), /100 probabilities/);
  const wrongMass = Array(100).fill(0.11);
  assert.throws(() => validateProbabilities(wrongMass), /sum to 10/);
});

test("ticket geometry is strict", () => {
  assert.equal(validateTicket([1, 2, 3, 4, 5]), true);
  assert.throws(() => validateTicket([1, 1, 2, 3, 4]), /unique/);
  assert.throws(() => validateTicket([1, 2, 3, 4, 100]), /0\.\.99/);
});

test("portfolio budget equals committed tickets", () => {
  const tickets = [
    [1, 2, 3, 4, 5],
    [6, 7, 8, 9, 10],
    [11, 12, 13, 14, 15],
    [16, 17, 18, 19, 20],
    [21, 22, 23, 24, 25],
    [26, 27, 28, 29, 30],
  ];
  assert.equal(validatePortfolio(tickets, 2000, 12000), true);
  assert.throws(() => validatePortfolio(tickets, 2000, 10000), /budget/);
});

test("canonical dataset snapshot hash has SHA-256 shape", () => {
  assert.equal(assertSha256("7c9d26235dbec169023ef7ff28241b6da30512f706d029be6dd60222905dc882"), true);
  assert.throws(() => assertSha256("not-a-hash"), /SHA-256/);
});

test("all three K6 designs have 30 unique four-subsets and pairwise overlap one", () => {
  for (const portfolio of [weighted15, consensus15, random15]) {
    const g = portfolioGeometry(portfolio);
    assert.deepEqual(g, {
      uniqueNumbers: 15,
      uniqueFourSubsets: 30,
      duplicateFourSubsets: 0,
      maxPairwiseOverlap: 1,
      minNumberUsage: 2,
      maxNumberUsage: 2,
    });
  }
});

test("same K6 geometry has identical exact null probability regardless of labels", () => {
  const a = exactNullPortfolioMetrics(weighted15);
  const b = exactNullPortfolioMetrics(consensus15);
  const c = exactNullPortfolioMetrics(random15);
  close(a.pAtLeast4, 0.00152459516373242);
  close(a.pAtLeast3, 0.03831378202070554);
  close(a.pAtLeast5, 0.000020082930918988622);
  close(a.pAtLeast4, b.pAtLeast4);
  close(a.pAtLeast4, c.pAtLeast4);
  close(a.oddsAtLeast4, 655.9118274728496, 1e-10);
});

test("six-number wheel concentrates risk and lowers chance of at least one 4+", () => {
  const diversified = exactNullPortfolioMetrics(weighted15);
  const wheel = exactNullPortfolioMetrics(wheel6);
  const g = portfolioGeometry(wheel6);
  assert.equal(g.uniqueNumbers, 6);
  assert.equal(g.uniqueFourSubsets, 15);
  assert.equal(g.duplicateFourSubsets, 15);
  assert.equal(g.maxPairwiseOverlap, 4);
  close(wheel.pAtLeast4, 0.0007247500193783428);
  assert.ok(diversified.pAtLeast4 > wheel.pAtLeast4 * 2);
  close(diversified.expected4PlusTickets, wheel.expected4PlusTickets);
});
