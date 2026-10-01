export function assertProspectiveCutoff(trainedThrough, targetDraw) {
  if (!Number.isInteger(trainedThrough) || !Number.isInteger(targetDraw)) {
    throw new TypeError("draw numbers must be integers");
  }
  if (trainedThrough >= targetDraw) {
    throw new Error(`look-ahead detected: trained through ${trainedThrough}, target ${targetDraw}`);
  }
  return true;
}

export function validateProbabilities(probabilities, tolerance = 1e-9) {
  if (!Array.isArray(probabilities) || probabilities.length !== 100) {
    throw new Error("a SCIENCE_CORE_V1 run requires exactly 100 probabilities");
  }
  if (probabilities.some((p) => !Number.isFinite(p) || p < 0 || p > 1)) {
    throw new Error("every probability must be finite and between 0 and 1");
  }
  const total = probabilities.reduce((sum, p) => sum + p, 0);
  if (Math.abs(total - 10) > tolerance) {
    throw new Error(`probabilities must sum to 10; got ${total}`);
  }
  return true;
}

export function validateTicket(numbers) {
  if (!Array.isArray(numbers) || numbers.length !== 5) {
    throw new Error("a ticket requires exactly 5 numbers");
  }
  if (new Set(numbers).size !== 5) {
    throw new Error("ticket numbers must be unique");
  }
  if (numbers.some((n) => !Number.isInteger(n) || n < 0 || n > 99)) {
    throw new Error("ticket numbers must be integers in 0..99");
  }
  return true;
}

export function validatePortfolio(tickets, ticketPrice, budget) {
  if (!Array.isArray(tickets) || tickets.length < 1) {
    throw new Error("portfolio requires at least one ticket");
  }
  tickets.forEach(validateTicket);
  if (!Number.isFinite(ticketPrice) || ticketPrice < 0 || !Number.isFinite(budget) || budget < 0) {
    throw new Error("ticket price and budget must be non-negative finite numbers");
  }
  const committed = tickets.length * ticketPrice;
  if (Math.abs(committed - budget) > 1e-9) {
    throw new Error(`budget must equal committed ticket cost; expected ${committed}, got ${budget}`);
  }
  return true;
}

export function assertSha256(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("expected a lowercase SHA-256 hex digest");
  }
  return true;
}
