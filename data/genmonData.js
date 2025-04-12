// Helper to generate unique IDs (used locally and exported)
function generateUniqueId() {
    return Math.random().toString(36).substring(2, 11);
}


const genmonData = {
    "Flufflame": {
        id: "Fluff01",
        name: "Flufflame",
        type: ["Fire"],
        stats: { hp: 45, atk: 60, def: 40, spd: 70 },
        moves: ["Fur Blaze", "Hot Pounce"],
        sprite: "/assets/flufflame.png",
        description: "A small red-and-orange fox-like creature with a fluffy tail that glows like embers. It has big curious eyes, ember-tipped ears, and leaves fiery pawprints wherever it walks.",
        catchRate: 180
    },
    "Aquaphin": {
        id: "Aqua01",
        name: "Aquaphin",
        type: ["Water"],
        stats: { hp: 50, atk: 45, def: 55, spd: 60 },
        moves: ["Bubble Jet", "Tail Slap"],
        sprite: "/assets/aquaphin.png",
        description: "A playful blue dolphin-like Genmon with glowing aqua fins and a crystal-like orb on its forehead. Its body shimmers like flowing water, and it can hover briefly using water jets.",
        catchRate: 190
    },
    "Thorncub": {
        id: "Thorn01",
        name: "Thorncub",
        type: ["Grass"],
        stats: { hp: 55, atk: 50, def: 50, spd: 55 },
        moves: ["Vine Snap", "Leaf Dash"],
        sprite: "/assets/thorncub.png",
        description: "A green cub-shaped Genmon with vines wrapping its legs and small leaves sprouting from its back. Its tail ends in a thorny bud, and it growls softly with a leafy crunch underfoot.",
        catchRate: 170
    },
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

    // Placeholder for Catch action (used internally, not selectable)
    "Catch": { power: 0, type: "Normal", accuracy: 100, priority: 0, effect: "Attempt to catch" },
};

// --- Type Effectiveness ---
const typeEffectiveness = {
    "Fire": { "Grass": 2, "Water": 0.5, "Fire": 0.5, "Normal": 1 },
    "Water": { "Fire": 2, "Water": 0.5, "Grass": 0.5, "Normal": 1 },
    "Grass": { "Water": 2, "Fire": 0.5, "Grass": 0.5, "Normal": 1 },
    "Normal": { "Fire": 1, "Water": 1, "Grass": 1, "Normal": 1 }, // Normal hits everything neutrally
    // Add other types as needed
};

// Function to get effectiveness multiplier and message
function getEffectiveness(moveType, defenderTypes) {
    let multiplier = 1;
    if (typeEffectiveness[moveType]) {
        defenderTypes.forEach(defType => {
            multiplier *= typeEffectiveness[moveType][defType] ?? 1; // Use 1 if type interaction undefined
        });
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
    if (!move || !attackerGenmon || !defenderGenmon || move.power === 0) {
        return { damage: 0, effectivenessMessage: null }; // No damage for non-power moves
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

    // Simplified Damage Formula
    // Using basic formula, can be expanded (Level, STAB, Critical Hits, etc.)
    const attackStat = attackerGenmon.stats.atk || 10; // Use default if missing
    const defenseStat = defenderGenmon.stats.def || 10;
    const baseDamage = ((attackStat / defenseStat) * move.power * 0.2) + 2; // Adjusted scaling
    const randomFactor = (Math.random() * 0.15 + 0.85); // 85% to 100% damage randomness

    let finalDamage = Math.floor(baseDamage * effectiveness * randomFactor);

    // Ensure minimum 1 damage if it's not immune and the move has power
    if (finalDamage < 1 && effectiveness > 0 && move.power > 0) {
         finalDamage = 1;
    }

    console.log(`${attackerGenmon.name} (${attackStat} Atk) vs ${defenderGenmon.name} (${defenseStat} Def) using ${move.name} (Power ${move.power}, Type ${moveType}, Eff ${effectiveness}). Base: ${baseDamage.toFixed(1)}, Rand: ${randomFactor.toFixed(2)}, Final: ${finalDamage}`);

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
    const hpFactor = (maxHp === 0) ? 1 : Math.max(1, (3 * maxHp - 2 * currentHp) / (3 * maxHp)); // Avoid division by zero, ensure factor >= 1? No, low HP increases chance. Max ensures > 0.
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
// Creates a fresh copy of a Genmon with full HP and a unique ID.
function createGenmonInstance(baseGenmonId) {
    const baseData = genmonData[baseGenmonId];
    if (!baseData) {
        console.error(`Genmon base data not found for ID: ${baseGenmonId}`);
        return null;
    }
    // Deep copy to prevent modifying the original data object
    const instance = JSON.parse(JSON.stringify(baseData));

    // Ensure stats object exists
    instance.stats = instance.stats || { hp: 30, atk: 30, def: 30, spd: 30 }; // Basic default stats

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