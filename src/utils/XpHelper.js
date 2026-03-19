// src/utils/XpHelper.js

class XpHelper {
  /**
   * Calculates the total cumulative XP required to reach a specific level.
   * Based on the cumulative sum of the linear progression (238i + 179):
   * TotalXP(L) = 119L² + 298L
   * @param {number} level
   * @returns {number} The total XP required
   */
  static getXpFromLevel(level) {
    if (level <= 0) return 0;
    return 119 * level * level + 298 * level;
  }

  /**
   * Calculates the current level based on total cumulative XP.
   * Inverse of the quadratic formula: L = (-298 + sqrt(298² + 4 * 119 * XP)) / (2 * 119)
   * @param {number} xp
   * @returns {number} The current level (floored integer)
   */
  static getLevelFromXp(xp) {
    if (xp < 417) return 0; // Level 1 starts at 417 XP (119 + 298)
    // Solving 119L² + 298L - XP = 0
    const level = (-298 + Math.sqrt(298 * 298 + 4 * 119 * xp)) / (2 * 119);
    return Math.floor(level);
  }

  /**
   * Calculates the XP needed to progress from currentLevel to currentLevel + 1.
   * @param {number} currentLevel
   * @returns {number}
   */
  static getXpRequiredForNextLevel(currentLevel) {
    return this.getXpFromLevel(currentLevel + 1) - this.getXpFromLevel(currentLevel);
  }

  /**
   * Optional helper to get progress in the current level.
   * @param {number} xp Total XP
   * @returns {Object} { currentLevel, currentLevelXp, xpForNextLevel, progressPercent }
   */
  static getLevelProgress(xp) {
    const level = this.getLevelFromXp(xp);
    const xpForThisLevel = this.getXpFromLevel(level);
    const xpForNextLevel = this.getXpFromLevel(level + 1);

    // How much XP the user has earned *since* reaching their current level
    const progressXp = xp - xpForThisLevel;
    // How much XP is required total to jump from current level to next
    const requiredXp = xpForNextLevel - xpForThisLevel;

    const progressPercent = Math.min(1.0, Math.max(0.0, progressXp / requiredXp));

    return {
      level,
      progressXp, // E.g., 50 (XP earned in exactly this level)
      requiredXp, // E.g., 100 (Total XP needed to level up)
      nextLevelXp: xpForNextLevel, // Cumulative XP for next level
      progressPercent,
    };
  }
}

module.exports = { XpHelper };
