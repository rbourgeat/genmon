const genmonData = {
    "Pikachu": {
        id: "Pika01",
        name: "Pikachu",
        type: ["Electric"],
        stats: { hp: 35, atk: 55, def: 40, spd: 90 },
        moves: ["Thunder Shock", "Quick Attack"],
        sprite: "/assets/pikachu.png"
    },
    "Charmander": {
        id: "Char01",
        name: "Charmander",
        type: ["Fire"],
        stats: { hp: 39, atk: 52, def: 43, spd: 65 },
        moves: ["Scratch", "Ember"],
        sprite: "/assets/charmander.png"
    },
};

const moveData = {
    "Thunder Shock": { power: 40, type: "Electric", accuracy: 100 },
    "Quick Attack": { power: 40, type: "Normal", accuracy: 100, priority: 1 },
    "Scratch": { power: 40, type: "Normal", accuracy: 100 },
    "Ember": { power: 40, type: "Fire", accuracy: 100 },
}

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