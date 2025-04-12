// Centralized game state
let players = {}; // Store player data { id: { ws, x, y, direction, team: [genmonInstance...], activeGenmonIndex, inBattle, currentBattleId, ... } }
let activeBattles = {}; // Stores state for ongoing battles { battleId: { type: 'PvP'/'PvE', player1Id, player2Id/wildGenmon, turn, log, ... } }

function getPlayer(playerId) {
    return players[playerId];
}

function addPlayer(playerId, playerData) {
    players[playerId] = playerData;
}

function removePlayer(playerId) {
    delete players[playerId];
}

function getAllPlayers() {
    return players;
}

function updatePlayer(playerId, updates) {
    if (players[playerId]) {
        players[playerId] = { ...players[playerId], ...updates };
    }
}

function getBattle(battleId) {
    return activeBattles[battleId];
}

function addBattle(battleId, battleData) {
    activeBattles[battleId] = battleData;
}

function removeBattle(battleId) {
    delete activeBattles[battleId];
}

function getAllBattles() {
    return activeBattles;
}

module.exports = {
    getPlayer,
    addPlayer,
    removePlayer,
    getAllPlayers,
    updatePlayer,
    getBattle,
    addBattle,
    removeBattle,
    getAllBattles,
};