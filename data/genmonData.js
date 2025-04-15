const { calculateXpToNextLevel, INITIAL_LEVEL } = require('../game/leveling');

// Helper to generate unique IDs (used locally and exported)
function generateUniqueId() {
    return Math.random().toString(36).substring(2, 11);
}


const genmonData = {
    "Flufflame": {
        id: "Fluff01",
        name: "Flufflame",
        type: ["Fire"],
        stats: { hp: 45, atk: 60, def: 40, spd: 70 }, // Base stats at level 1 ideally
        moves: ["Fur Blaze", "Hot Pounce"],
        sprite: "/assets/flufflame.png",
        description: "A pixel art of small red-and-orange fox-like creature with a fluffy tail that glows like embers. It has big curious eyes, ember-tipped ears, and leaves fiery pawprints wherever it walks.",
        catchRate: 180
    },
    "Aquaphin": {
        id: "Aqua01",
        name: "Aquaphin",
        type: ["Water"],
        stats: { hp: 50, atk: 45, def: 55, spd: 60 },
        moves: ["Bubble Jet", "Tail Slap"],
        sprite: "/assets/aquaphin.png",
        description: "A pixel art of a playful blue dolphin-like Genmon with glowing aqua fins and a crystal-like orb on its forehead. Its body shimmers like flowing water, and it can hover briefly using water jets.",
        catchRate: 190
    },
    "Thorncub": {
        id: "Thorn01",
        name: "Thorncub",
        type: ["Grass"],
        stats: { hp: 55, atk: 50, def: 50, spd: 55 },
        moves: ["Vine Snap", "Leaf Dash"],
        sprite: "/assets/thorncub.png",
        description: "A pixel art of a green cub-shaped Genmon with vines wrapping its legs and small leaves sprouting from its back. Its tail ends in a thorny bud, and it growls softly with a leafy crunch underfoot.",
        catchRate: 170
    },
    "Rockadillo": {
        id: "Rock01",
        name: "Rockadillo",
        type: ["Normal", "Rock"],
        stats: { hp: 65, atk: 55, def: 80, spd: 30 },
        moves: ["Tail Slap", "Rock Throw"],
        sprite: "/assets/rockadillo.png",
        description: "A pixel art of a sturdy creature resembling an armadillo, with rocky plates covering its back.",
        catchRate: 120
    }
};

const moveData = {
    // Fire
    "Fur Blaze": { power: 45, type: "Fire", accuracy: 100, priority: 0, effect: "May burn (10%)" },
    "Hot Pounce": { power: 50, type: "Fire", accuracy: 95, priority: 1 },

    // Water
    "Bubble Jet": { power: 40, type: "Water", accuracy: 100, priority: 0, effect: "May lower speed (10%)" },
    "Tail Slap": { power: 35, type: "Normal", accuracy: 100, priority: 0 },
    // Grass
    "Vine Snap": { power: 45, type: "Grass", accuracy: 100, priority: 0, effect: "May cause flinch (10%)" },
    "Leaf Dash": { power: 50, type: "Grass", accuracy: 95, priority: 1 },

    // Rock
    "Rock Throw": { power: 50, type: "Rock", accuracy: 90, priority: 0 },

    // Placeholder for Catch action (used internally, not selectable)
    "Catch": { power: 0, type: "Normal", accuracy: 100, priority: 0, effect: "Attempt to catch" },
};

// --- Type Effectiveness ---
const typeEffectiveness = {
    "Fire": { "Grass": 2, "Water": 0.5, "Fire": 0.5, "Normal": 1, "Rock": 0.5 },
    "Water": { "Fire": 2, "Water": 0.5, "Grass": 0.5, "Normal": 1, "Rock": 2 },
    "Grass": { "Water": 2, "Fire": 0.5, "Grass": 0.5, "Normal": 1, "Rock": 2 },
    "Normal": { "Fire": 1, "Water": 1, "Grass": 1, "Normal": 1, "Rock": 0.5 },
    "Rock": { "Fire": 2, "Water": 1, "Grass": 1, "Normal": 1, "Rock": 1 },
    // Add other types as needed
};

// Function to get effectiveness multiplier and message
function getEffectiveness(moveType, defenderTypes) {
    let multiplier = 1;
    const primaryMoveType = typeEffectiveness[moveType];
    if (primaryMoveType) {
        defenderTypes.forEach(defType => {
            multiplier *= primaryMoveType[defType] ?? 1; // Use 1 if type interaction undefined
        });
    } else {
        console.warn(`Effectiveness data missing for move type: ${moveType}`);
    }

    let message = null;
    if (multiplier > 1) message = "It's super effective!";
    else if (multiplier < 1 && multiplier > 0) message = "It's not very effective...";
    else if (multiplier === 0) message = "It had no effect.";

    return { multiplier, message };
}

// --- Damage Calculation ---
// Returns object: { damage: number, effectivenessMessage: string | null }
function calculateDamage(attackerGenmon, defenderGenmon, move) {
    if (!move || !attackerGenmon || !defenderGenmon || !attackerGenmon.stats || !defenderGenmon.stats || !attackerGenmon.level || !defenderGenmon.level || move.power === 0) {
        console.warn("Missing data for damage calculation", { attackerGenmon, defenderGenmon, move });
        return { damage: 0, effectivenessMessage: null };
    }

    // Accuracy Check
    if (Math.random() * 100 >= move.accuracy) {
        console.log(`${attackerGenmon.name}'s ${move.name} missed!`);
        return { damage: 0, effectivenessMessage: "But it missed!" }; // Missed
    }

    const moveType = move.type;
    const defenderTypes = defenderGenmon.type || ["Normal"]; // Assume Normal if type is missing

    // Get Effectiveness
    const { multiplier: effectiveness, message: effectivenessMessage } = getEffectiveness(moveType, defenderTypes);

    // If immune, return 0 damage
    if (effectiveness === 0) {
         console.log(`${move.name} had no effect on ${defenderGenmon.name}.`);
        return { damage: 0, effectivenessMessage: effectivenessMessage };
    }

    // --- Slightly Improved Damage Formula (incorporating Level) ---
    const levelFactor = (2 * attackerGenmon.level / 5) + 2;
    const attackStat = attackerGenmon.stats.atk || 10;
    const defenseStat = defenderGenmon.stats.def || 10;
    const baseDamage = (((levelFactor * move.power * (attackStat / defenseStat)) / 50) + 2);
    const randomFactor = (Math.random() * 0.15 + 0.85); // 85% to 100% damage randomness
    // Add STAB (Same-type attack bonus) later if needed: * (attackerGenmon.type.includes(move.type) ? 1.5 : 1)

    let finalDamage = Math.floor(baseDamage * effectiveness * randomFactor);

    // Ensure minimum 1 damage if it's not immune and the move has power
    if (finalDamage < 1 && effectiveness > 0 && move.power > 0) {
         finalDamage = 1;
    }

    console.log(`${attackerGenmon.name} (Lvl ${attackerGenmon.level}, ${attackStat} Atk) vs ${defenderGenmon.name} (Lvl ${defenderGenmon.level}, ${defenseStat} Def) using ${move.name} (Power ${move.power}, Type ${moveType}, Eff ${effectiveness.toFixed(1)}). Base: ${baseDamage.toFixed(1)}, Rand: ${randomFactor.toFixed(2)}, Final: ${finalDamage}`);

    return { damage: finalDamage, effectivenessMessage: effectivenessMessage };
}


// --- Catch Calculation ---
function calculateCatchSuccess(wildGenmon) {
    if (!wildGenmon || !wildGenmon.stats || wildGenmon.currentHp === undefined) return false;

    const maxHp = wildGenmon.stats.hp;
    const currentHp = wildGenmon.currentHp;
    const baseRate = wildGenmon.catchRate || 100; // Use defined rate or default

    // Formula inspired by Bulbapedia (simplified - ignores ball bonuses, status)
    // Calculate 'a' value
    const hpFactor = (maxHp === 0) ? 1 : Math.max(0.1, (3 * maxHp - 2 * currentHp) / (3 * maxHp)); // Ensure HP factor doesn't go below 0.1
    const a = hpFactor * baseRate;

    // Calculate catch probability (simplified from shake checks)
    // Using a simpler direct chance calculation for now
    const catchValue = Math.max(1, Math.floor(a)) / 255; // Chance out of 255, ensure at least 1
    const catchChancePercent = Math.min(100, catchValue * 100); // Convert to percentage

    const randomRoll = Math.random() * 100;

    console.log(`Catch attempt: Rate=${baseRate}, MaxHP=${maxHp}, CurrHP=${currentHp}, HP Factor=${hpFactor.toFixed(2)}, 'a'=${a.toFixed(2)}, Chance=${catchChancePercent.toFixed(2)}%, Rolled=${randomRoll.toFixed(2)}`);

    return randomRoll < catchChancePercent;
}


// --- Create Genmon Instance ---
// Creates a fresh copy of a Genmon with full HP, a unique ID, and initial level/XP.
function createGenmonInstance(baseGenmonId, level = INITIAL_LEVEL) {
    const baseData = genmonData[baseGenmonId];
    if (!baseData) {
        console.error(`Genmon base data not found for ID: ${baseGenmonId}`);
        return null;
    }
    // Deep copy to prevent modifying the original data object
    const instance = JSON.parse(JSON.stringify(baseData));

    // Assign base stats (these are typically considered level 1 or level 50/100 bases)
    instance.stats = instance.stats || { hp: 30, atk: 30, def: 30, spd: 30 }; // Basic default stats
    const baseStats = { ...instance.stats }; // Keep a copy of true base stats if needed for complex growth

    // Initialize level and XP
    instance.level = Math.max(1, level); // Ensure level is at least 1
    instance.xp = 0; // Start with 0 XP towards the *next* level
    instance.xpToNextLevel = calculateXpToNextLevel(instance.level); // Calculate XP needed for the next level

    // Scale stats based on level (simple linear scaling for now)
    // A more robust system would use base stats, IVs, EVs, and nature.
    // This basic scaling assumes base stats are for level 1.
    if (instance.level > 1) {
         const levelMultiplier = 1 + (instance.level - 1) * 0.1; // +10% stats per level approx.
         instance.stats.hp = Math.floor(baseStats.hp * levelMultiplier);
         instance.stats.atk = Math.floor(baseStats.atk * levelMultiplier);
         instance.stats.def = Math.floor(baseStats.def * levelMultiplier);
         instance.stats.spd = Math.floor(baseStats.spd * levelMultiplier);
    }
     // Ensure stats are at least 1
     instance.stats.hp = Math.max(1, instance.stats.hp);
     instance.stats.atk = Math.max(1, instance.stats.atk);
     instance.stats.def = Math.max(1, instance.stats.def);
     instance.stats.spd = Math.max(1, instance.stats.spd);


    // Initialize currentHp to max HP
    instance.currentHp = instance.stats.hp;

    // Assign a unique ID to this specific instance
    instance.uniqueId = generateUniqueId();

    // Add other potential initial state properties here (e.g., status effects: null)
    instance.status = null;

    return instance;
}


module.exports = {
    genmonData,
    moveData,
    typeEffectiveness, // Export if needed elsewhere
    calculateDamage,
    calculateCatchSuccess,
    createGenmonInstance,
    generateUniqueId // Export for potential use in other modules if needed
};