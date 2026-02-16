const ALL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Generates a Case ID based on a numeric counter.
 * Format: A1 ... A9, B1 ... B9, ... Z9, AA1 ... AA9, etc.
 *
 * @param {number} count - The global punishment counter (1-based)
 * @returns {string} The formatted Case ID
 */
function generateCaseId(count) {
  if (count < 1) count = 1;

  // Pattern: Letter(s) + Digit (1-9)
  // We need to map the counter to this sequence.
  // The cycle length is 9 (1-9).

  // 1. Determine the digit part (1-9)
  // (count - 1) % 9 gives 0-8, so + 1 gives 1-9
  const digit = ((count - 1) % 9) + 1;

  // 2. Determine the letter part index
  // Each block of 9 increments the letter index.
  // letterIndex = floor((count - 1) / 9)
  let letterIndex = Math.floor((count - 1) / 9);

  // 3. Convert letterIndex to base-26 letters (A, B, ..., Z, AA, AB...)
  // This is similar to Excel column naming but 0-based for our calculation
  let letters = '';

  do {
    const remainder = letterIndex % 26;
    letters = ALL_LETTERS[remainder] + letters;
    letterIndex = Math.floor(letterIndex / 26) - 1;
  } while (letterIndex >= 0);

  return `${letters}${digit}`;
}

module.exports = { generateCaseId };
