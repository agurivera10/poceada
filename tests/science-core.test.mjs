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
