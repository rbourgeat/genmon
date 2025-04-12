const genmonData = {
    "Flufflame": {
        id: "Fluff01",
        name: "Flufflame",
        type: ["Fire"],
        stats: { hp: 45, atk: 60, def: 40, spd: 70 },
        moves: ["Fur Blaze", "Hot Pounce"],
        sprite: "/assets/flufflame.png",
        description: "A small red-and-orange fox-like creature with a fluffy tail that glows like embers. It has big curious eyes, ember-tipped ears, and leaves fiery pawprints wherever it walks."
    },
    "Aquaphin": {
        id: "Aqua01",
        name: "Aquaphin",
        type: ["Water"],
        stats: { hp: 50, atk: 45, def: 55, spd: 60 },
        moves: ["Bubble Jet", "Tail Slap"],
        sprite: "/assets/aquaphin.png",
        description: "A playful blue dolphin-like Genmon with glowing aqua fins and a crystal-like orb on its forehead. Its body shimmers like flowing water, and it can hover briefly using water jets."
    },
    "Thorncub": {
        id: "Thorn01",
        name: "Thorncub",
        type: ["Grass"],
        stats: { hp: 55, atk: 50, def: 50, spd: 55 },
        moves: ["Vine Snap", "Leaf Dash"],
        sprite: "/assets/thorncub.png",
        description: "A green cub-shaped Genmon with vines wrapping its legs and small leaves sprouting from its back. Its tail ends in a thorny bud, and it growls softly with a leafy crunch underfoot."
    },
};

const moveData = {
    "Fur Blaze": { power: 45, type: "Fire", accuracy: 100, effect: "May burn (10%)" },
    "Hot Pounce": { power: 50, type: "Fire", accuracy: 95, priority: 1 },

    "Bubble Jet": { power: 40, type: "Water", accuracy: 100, effect: "May lower speed (10%)" },
    "Tail Slap": { power: 35, type: "Normal", accuracy: 100 },

    "Vine Snap": { power: 45, type: "Grass", accuracy: 100, effect: "May cause flinch (10%)" },
    "Leaf Dash": { power: 50, type: "Grass", accuracy: 95, priority: 1 },
};

const typeEffectiveness = {
    "Electric": { "Water": 2, "Ground": 0, "Flying": 2, "Electric": 0.5 },
    "Fire": { "Grass": 2, "Water": 0.5, "Ice": 2, "Bug": 2, "Rock": 0.5, "Fire": 0.5 },
    "Water": { "Fire": 2, "Ground": 2, "Rock": 2, "Water": 0.5, "Grass": 0.5, "Dragon": 0.5 },
    "Grass": { "Water": 2, "Ground": 2, "Rock": 2, "Fire": 0.5, "Poison": 0.5, "Flying": 0.5, "Bug": 0.5, "Grass": 0.5 },
    "Normal": {},
};

function calculateDamage(attackerGenmon, defenderGenmon, move) {
    if (!move || !attackerGenmon || !defenderGenmon) return 0;
    if (Math.random() * 100 > move.accuracy) return 0;

    const moveType = move.type;
    let effectiveness = 1;
    defenderGenmon.type.forEach(defType => {
        if (typeEffectiveness[moveType] && typeEffectiveness[moveType][defType] !== undefined) {
            effectiveness *= typeEffectiveness[moveType][defType];
        }
    });

    const damage = Math.floor(
        ( (attackerGenmon.stats.atk / defenderGenmon.stats.def) * move.power * effectiveness) / 5 + 2
    );
    return Math.max(1, damage);
}


module.exports = { genmonData, moveData, calculateDamage };