// ./data/genmonData.js
const genmonData = {
    "Flufflame": {
        id: "Fluff01",
        name: "Flufflame",
        type: ["Fire"],
        stats: { hp: 45, atk: 60, def: 40, spd: 70 },
        moves: ["Fur Blaze", "Hot Pounce"],
        sprite: "/assets/flufflame.png", // Base sprite
        // Add directional sprites later if available:
        // spriteUp: "/assets/flufflame_up.png",
        // spriteDown: "/assets/flufflame_down.png",
        // spriteLeft: "/assets/flufflame_left.png",
        // spriteRight: "/assets/flufflame_right.png",
        description: "A small red-and-orange fox-like creature with a fluffy tail that glows like embers. It has big curious eyes, ember-tipped ears, and leaves fiery pawprints wherever it walks.",
        catchRate: 180 // Example catch rate (0-255, higher is easier)
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
    "Fur Blaze": { power: 45, type: "Fire", accuracy: 100, effect: "May burn (10%)" },
    "Hot Pounce": { power: 50, type: "Fire", accuracy: 95, priority: 1 },
    "Bubble Jet": { power: 40, type: "Water", accuracy: 100, effect: "May lower speed (10%)" },
    "Tail Slap": { power: 35, type: "Normal", accuracy: 100 },
    "Vine Snap": { power: 45, type: "Grass", accuracy: 100, effect: "May cause flinch (10%)" },
    "Leaf Dash": { power: 50, type: "Grass", accuracy: 95, priority: 1 },

    // Add a basic non-damaging move for catching
    "Catch": { power: 0, type: "Normal", accuracy: 100, effect: "Attempt to catch" }
};

// --- Type Effectiveness (simplified, can be expanded) ---
const typeEffectiveness = {
    "Fire": { "Grass": 2, "Water": 0.5, "Fire": 0.5 },
    "Water": { "Fire": 2, "Water": 0.5, "Grass": 0.5 },
    "Grass": { "Water": 2, "Fire": 0.5, "Grass": 0.5 },
    "Normal": {},
    // Add other types as needed
};

// --- Damage Calculation (Remains similar, but might need adjustments) ---
function calculateDamage(attackerGenmon, defenderGenmon, move) {
    if (!move || !attackerGenmon || !defenderGenmon || move.power === 0) return 0; // No damage for non-power moves

    // Basic Accuracy Check
    if (Math.random() * 100 > move.accuracy) {
        console.log(`${attackerGenmon.name}'s ${move.name} missed!`);
        return 0; // Missed
    }

    const moveType = move.type;
    let effectiveness = 1;

    // Check defender's type(s) against move type
    if (defenderGenmon.type && Array.isArray(defenderGenmon.type)) {
        defenderGenmon.type.forEach(defType => {
            if (typeEffectiveness[moveType] && typeEffectiveness[moveType][defType] !== undefined) {
                effectiveness *= typeEffectiveness[moveType][defType];
            }
        });
    }

    // Simplified Damage Formula (adjust as needed)
    const baseDamage = ((attackerGenmon.stats.atk / defenderGenmon.stats.def) * move.power) / 10 + 2;
    const randomFactor = (Math.random() * 0.15 + 0.85); // 85% to 100% damage randomness

    let finalDamage = Math.floor(baseDamage * effectiveness * randomFactor);

    console.log(`${attackerGenmon.name} (${attackerGenmon.stats.atk} Atk) vs ${defenderGenmon.name} (${defenderGenmon.stats.def} Def) using ${move.name} (Power ${move.power}, Type ${moveType}, Effectiveness ${effectiveness}). Base: ${baseDamage.toFixed(2)}, Random: ${randomFactor.toFixed(2)}, Final: ${finalDamage}`);


    return Math.max(1, finalDamage); // Minimum 1 damage
}


// --- Catch Calculation (Simplified) ---
function calculateCatchSuccess(wildGenmon, playerTeamHpFactor = 1) { // playerTeamHpFactor unused for now
    const baseRate = wildGenmon.catchRate || 100; // Default if undefined
    const hpFactor = (wildGenmon.stats.hp * 3 - wildGenmon.currentHp * 2) / (wildGenmon.stats.hp * 3);
    const catchValue = Math.floor(((baseRate + 1) / 256) * hpFactor * 100); // Simplified chance %

    const randomRoll = Math.random() * 100;
    console.log(`Catch attempt: Rate=${baseRate}, HP Factor=${hpFactor.toFixed(2)}, Chance=${catchValue.toFixed(2)}%, Rolled=${randomRoll.toFixed(2)}`);

    return randomRoll < catchValue;
}


// Helper to create a unique instance of a Genmon for teams/wild encounters
function createGenmonInstance(baseGenmonId) {
    const baseData = genmonData[baseGenmonId];
    if (!baseData) return null;
    // Deep copy to avoid modifying original data
    const instance = JSON.parse(JSON.stringify(baseData));
    instance.currentHp = instance.stats.hp; // Start with full HP
    instance.uniqueId = generateUniqueId(); // Give it a unique ID within the team/battle
    // Add status effects etc. later
    return instance;
}

// Needs a unique ID generator if not already present
function generateUniqueId() {
    return Math.random().toString(36).substring(2, 11);
}

module.exports = {
    genmonData,
    moveData,
    calculateDamage,
    calculateCatchSuccess,
    createGenmonInstance,
    generateUniqueId // Export if needed elsewhere, like server.js
};