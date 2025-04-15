const WebSocket = require('ws');
const gameState = require('../gameState');
const { sendInfo, broadcast, generateUniqueId } = require('../utils');
const { INITIAL_LEVEL } = require('../constants');
const { genmonData, createGenmonInstance } = require('../../data/genmonData');
const { requestPlayerAction } = require('./actions'); // Import from actions.js

// --- Wild Battle ---
function startWildBattle(playerId) {
    const player = gameState.getPlayer(playerId);
    if (!player || player.inBattle || player.team.length === 0) return;

    const firstHealthyIndex = player.team.findIndex(g => g && g.currentHp > 0); // Added check for g existing
    if (firstHealthyIndex === -1) {
        sendInfo(player.ws, "All your Genmon have fainted!");
        return;
    }

    let activeIndex = player.activeGenmonIndex;
    // Ensure active genmon exists and is healthy
    if (!player.team[activeIndex] || player.team[activeIndex].currentHp <= 0) {
        activeIndex = firstHealthyIndex;
        gameState.updatePlayer(playerId, { activeGenmonIndex: activeIndex });
    }
    const playerActiveGenmon = player.team[activeIndex];
    if (!playerActiveGenmon) { // Should not happen after above checks, but safety first
        console.error(`Player ${playerId} has no valid active Genmon for wild battle start.`);
        sendInfo(player.ws, "Error finding an active Genmon to start the battle.");
        return;
    }


    const availableGenmonIds = Object.keys(genmonData);
    if (availableGenmonIds.length === 0) {
        console.error("No Genmon data available to start wild battle.");
        sendInfo(player.ws, "Error: No wild Genmon data found.");
        return;
    }
    const wildGenmonId = availableGenmonIds[Math.floor(Math.random() * availableGenmonIds.length)];

    const playerLevel = playerActiveGenmon.level || INITIAL_LEVEL;
    const wildLevel = Math.max(1, playerLevel + Math.floor(Math.random() * 5) - 2); // +/- 2 levels around player's active
    const wildGenmonInstance = createGenmonInstance(wildGenmonId, wildLevel);

    if (!wildGenmonInstance) {
        console.error(`Failed to create wild Genmon instance for ID: ${wildGenmonId}`);
        sendInfo(player.ws, "Error creating wild Genmon.");
        return;
    }

    const battleId = generateUniqueId();

    const battleData = {
        id: battleId,
        type: 'PvE',
        playerId: playerId,
        wildGenmon: wildGenmonInstance,
        playerGenmonUniqueId: playerActiveGenmon.uniqueId,
        turn: playerId, // Player usually goes first (speed check in turn processing)
        log: [`A wild Level ${wildGenmonInstance.level} ${wildGenmonInstance.name} appeared!`],
        turnNumber: 1,
        waitingForAction: playerId, // Set initial waiting player
        playerAction: null,
        opponentAction: null,
        p1MustSwitch: false,
        participants: {
             [playerId]: new Set([playerActiveGenmon.uniqueId])
        },
        ended: false,
    };
    gameState.addBattle(battleId, battleData);

    gameState.updatePlayer(playerId, { inBattle: true, currentBattleId: battleId, activeGenmonIndex: activeIndex });
    // Ensure local player object reference is updated if it exists
    if(player) {
        player.inBattle = true;
        player.currentBattleId = battleId;
        player.activeGenmonIndex = activeIndex;
    }

    const battleStartData = {
        type: 'WILD_BATTLE_START',
        payload: {
            battleId: battleId,
            playerGenmon: playerActiveGenmon,
            opponentGenmon: wildGenmonInstance,
            initialLog: battleData.log
        }
    };

    if (player.ws && player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(JSON.stringify(battleStartData));
        // Broadcast after sending to player
        broadcast(player.ws.server, gameState.getAllPlayers(), { type: 'PLAYER_IN_BATTLE', payload: { playerIds: [playerId] } }, player.ws);
    } else {
        console.error(`Cannot start wild battle for ${playerId}, WebSocket not open.`);
        // Clean up battle? For now, disconnect handles it.
        gameState.removeBattle(battleId);
        gameState.updatePlayer(playerId, { inBattle: false, currentBattleId: null });
        return;
    }

    requestPlayerAction(playerId, battleId);
}

module.exports = {
    startWildBattle,
};