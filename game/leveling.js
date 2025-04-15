const { genmonData } = require('../data/genmonData'); // Access base data for stat calculations
const { INITIAL_LEVEL, BASE_XP_GAIN } = require('./constants');

// XP required for next level (medium-slow progression)
function calculateXpToNextLevel(level) {
    return Math.floor(10 * (level ** 1.5));
}

// Calculate stat gains on level up
// For simplicity, provides a small fixed increase + a small variable increase based on base stats
function calculateStatGain(genmonBaseId, newLevel) {
    const baseStats = genmonData[genmonBaseId]?.stats;
    if (!baseStats) {
        console.error(`Base stats not found for ${genmonBaseId} during level up.`);
        return { hp: 1, atk: 1, def: 1, spd: 1 }; // Minimal default gain on error
    }

    // Simple gain: 1 point fixed + potential extra point based on base stat relative value (e.g., higher base atk -> slightly better atk gain)
    // This is a basic placeholder, could be much more complex (IVs, EVs, specific growth rates)
    const gain = {
        hp: 1 + Math.floor(Math.random() * 2) + (baseStats.hp > 50 ? 1 : 0), // HP generally gains a bit more
        atk: 1 + (baseStats.atk > 50 ? Math.floor(Math.random() * 2) : 0),
        def: 1 + (baseStats.def > 50 ? Math.floor(Math.random() * 2) : 0),
        spd: 1 + (baseStats.spd > 50 ? Math.floor(Math.random() * 2) : 0),
    };
    // console.log(`Level ${newLevel} gains for ${genmonBaseId}:`, gain);
    return gain;
}

// Handles the level-up process for a single Genmon
// Returns details about the level up (new stats, levels gained) or null if no level up
function processLevelUp(genmon) {
    if (!genmon || !genmon.stats || typeof genmon.xp !== 'number' || typeof genmon.level !== 'number') {
        console.error("Invalid Genmon data for level up processing:", genmon);
        return null;
    }

    let leveledUp = false;
    const initialLevel = genmon.level;
    const initialStats = { ...genmon.stats };
    const initialHp = genmon.currentHp;

    // Loop in case of multiple level ups from one XP gain
    while (genmon.xp >= genmon.xpToNextLevel) {
        leveledUp = true;
        const xpOver = genmon.xp - genmon.xpToNextLevel;
        genmon.level++;
        genmon.xp = xpOver; // Carry over excess XP
        genmon.xpToNextLevel = calculateXpToNextLevel(genmon.level); // Calculate for the *new* level

        // Calculate and apply stat gains
        const gains = calculateStatGain(genmon.name, genmon.level); // Assuming genmon.name is the base ID key
        const oldMaxHp = genmon.stats.hp;

        genmon.stats.hp += gains.hp;
        genmon.stats.atk += gains.atk;
        genmon.stats.def += gains.def;
        genmon.stats.spd += gains.spd;

        // Heal by the amount max HP increased
        const hpIncrease = genmon.stats.hp - oldMaxHp;
        genmon.currentHp = Math.min(genmon.stats.hp, genmon.currentHp + hpIncrease); // Heal, but don't exceed new max

         // TODO: Check for new moves learned at this level (requires move learning data)
         console.log(`${genmon.name} (ID: ${genmon.uniqueId}) leveled up to ${genmon.level}! HP increased by ${hpIncrease}.`);
    }

    if (leveledUp) {
        return {
            genmonUniqueId: genmon.uniqueId,
            levelsGained: genmon.level - initialLevel,
            newLevel: genmon.level,
            newStats: { ...genmon.stats },
            statGains: {
                hp: genmon.stats.hp - initialStats.hp,
                atk: genmon.stats.atk - initialStats.atk,
                def: genmon.stats.def - initialStats.def,
                spd: genmon.stats.spd - initialStats.spd,
            },
            newCurrentHp: genmon.currentHp,
            xpToNext: genmon.xpToNextLevel,
            currentXp: genmon.xp,
        };
    }

    return null; // No level up occurred
}

// Calculate XP yield for defeating a Genmon
function calculateXpYield(defeatedGenmon) {
    if (!defeatedGenmon || typeof defeatedGenmon.level !== 'number') {
        console.warn("Cannot calculate XP yield, invalid defeated Genmon:", defeatedGenmon);
        return 0;
    }
    // Simple formula: Base XP * Level modifier
    // More complex formula could consider winner/loser level difference
    const levelModifier = defeatedGenmon.level / INITIAL_LEVEL; // Scale based on starting level
    const xp = Math.floor(BASE_XP_GAIN * levelModifier * (0.8 + Math.random() * 0.4)); // Add some randomness +/- 20%
    return Math.max(1, xp); // Ensure at least 1 XP
}


module.exports = {
    calculateXpToNextLevel,
    calculateStatGain,
    processLevelUp,
    calculateXpYield,
};