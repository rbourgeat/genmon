const WebSocket = require('ws');
const gameState = require('../gameState');
const { sendInfo, broadcast, generateUniqueId } = require('../utils');
const { DUEL_MAX_DISTANCE } = require('../constants');
const { requestPlayerAction } = require('./actions'); // Import from actions.js

function handleInitiateDuel(challengerId, targetId) {
    const challenger = gameState.getPlayer(challengerId);
    const target = gameState.getPlayer(targetId);

    if (!challenger || !challenger.ws) {
        console.error(`Initiate Duel: Challenger ${challengerId} not found or no WebSocket.`);
        return; // Don't try to send info to non-existent player
    }
    if (!target || !target.ws) return sendInfo(challenger.ws, "Target player not found or not connected.");
    if (challengerId === targetId) return sendInfo(challenger.ws, "Cannot challenge yourself.");
    if (challenger.inBattle) return sendInfo(challenger.ws, "Cannot challenge while in battle.");
    if (target.inBattle) return sendInfo(challenger.ws, `${target.id} is already in a battle.`);
    if (!challenger.team || challenger.team.length === 0 || !challenger.team.some(g => g && g.currentHp > 0)) return sendInfo(challenger.ws, "You need a healthy Genmon to battle.");
    if (!target.team || target.team.length === 0 || !target.team.some(g => g && g.currentHp > 0)) return sendInfo(challenger.ws, `${target.id} has no healthy Genmon to battle.`);

    const distance = Math.abs(challenger.x - target.x) + Math.abs(challenger.y - target.y);
    if (distance > DUEL_MAX_DISTANCE) {
        return sendInfo(challenger.ws, "Target is too far away.");
    }

    // Check target WS state before sending
    if (target.ws.readyState === WebSocket.OPEN) {
        target.ws.send(JSON.stringify({
            type: 'DUEL_REQUEST',
            payload: {
                challengerId: challengerId,
                challengerName: challengerId // Use name later if available
            }
        }));
        sendInfo(challenger.ws, `Duel request sent to ${targetId}.`);
    } else {
        sendInfo(challenger.ws, `Could not send duel request to ${targetId} (disconnected).`);
    }
}

function handleRespondDuel(responderId, challengerId, accepted) {
    const responder = gameState.getPlayer(responderId);
    const challenger = gameState.getPlayer(challengerId);

    // Ensure both players and their WebSockets are still valid
    if (!responder || !responder.ws || responder.ws.readyState !== WebSocket.OPEN) {
        console.log(`Duel Response: Responder ${responderId} not available.`);
        // Inform challenger if they are still connected
        if (challenger && challenger.ws && challenger.ws.readyState === WebSocket.OPEN) {
            sendInfo(challenger.ws, `${responderId} could not respond (disconnected).`);
        }
        return;
    }
    if (!challenger || !challenger.ws || challenger.ws.readyState !== WebSocket.OPEN) {
        console.log(`Duel Response: Challenger ${challengerId} not available.`);
        sendInfo(responder.ws, `Could not respond to ${challengerId} (disconnected).`);
        return;
    }


    if (accepted) {
        // Re-check conditions before starting
        if (responder.inBattle || challenger.inBattle ||
            !responder.team || !responder.team.some(g => g && g.currentHp > 0) ||
            !challenger.team || !challenger.team.some(g => g && g.currentHp > 0)) {
            sendInfo(responder.ws, "Cannot start duel, opponent or you became busy or has no healthy Genmon.");
            sendInfo(challenger.ws, "Cannot start duel, opponent or you became busy or has no healthy Genmon.");
            return;
        }
        startDuel(challengerId, responderId);
    } else {
        sendInfo(challenger.ws, `${responderId} declined the duel.`);
        sendInfo(responder.ws, "Duel declined.");
    }
}

function startDuel(player1Id, player2Id) {
    const player1 = gameState.getPlayer(player1Id);
    const player2 = gameState.getPlayer(player2Id);

    // Double check players and teams exist after response handling
    if (!player1 || !player2 || !player1.team || !player2.team) {
         console.error(`Duel Start Error: Player or team data missing for ${player1Id} or ${player2Id}.`);
         // Attempt to inform players if possible
         if(player1?.ws?.readyState === WebSocket.OPEN) sendInfo(player1.ws, "Error starting duel: Player data missing.");
         if(player2?.ws?.readyState === WebSocket.OPEN) sendInfo(player2.ws, "Error starting duel: Player data missing.");
         return;
    }


    let p1ActiveIndex = player1.team.findIndex(g => g && g.currentHp > 0);
    if (p1ActiveIndex === -1) {
        console.error(`Duel Start Error: P1 (${player1Id}) has no healthy genmon.`);
        sendInfo(player1.ws, "Error starting duel: You have no healthy Genmon.");
        sendInfo(player2.ws, `Error starting duel: ${player1Id} has no healthy Genmon.`);
        return;
    }

    let p2ActiveIndex = player2.team.findIndex(g => g && g.currentHp > 0);
    if (p2ActiveIndex === -1) {
        console.error(`Duel Start Error: P2 (${player2Id}) has no healthy genmon.`);
        sendInfo(player2.ws, "Error starting duel: You have no healthy Genmon.");
        sendInfo(player1.ws, `Error starting duel: ${player2Id} has no healthy Genmon.`);
        return;
    }

    const p1Active = player1.team[p1ActiveIndex];
    const p2Active = player2.team[p2ActiveIndex];

    // Ensure active Genmon are valid objects with stats
     if (!p1Active || !p1Active.stats || !p2Active || !p2Active.stats) {
         console.error(`Duel Start Error: Active Genmon data invalid for ${player1Id} or ${player2Id}. P1: ${p1Active}, P2: ${p2Active}`);
         sendInfo(player1.ws, "Error starting duel: Active Genmon data invalid.");
         sendInfo(player2.ws, "Error starting duel: Active Genmon data invalid.");
         return;
     }


    const battleId = generateUniqueId();
    // Determine turn based on speed
    const p1Speed = p1Active.stats.spd || 0;
    const p2Speed = p2Active.stats.spd || 0;
    const fasterPlayerId = p1Speed >= p2Speed ? player1Id : player2Id;

    const battleData = {
        id: battleId,
        type: 'PvP',
        player1Id: player1Id,
        player2Id: player2Id,
        p1GenmonUniqueId: p1Active.uniqueId,
        p2GenmonUniqueId: p2Active.uniqueId,
        turn: fasterPlayerId, // Who goes first in the first turn
        waitingForAction: fasterPlayerId, // Whose action we are waiting for initially
        log: [`Duel started between ${player1Id} (${p1Active.name} Lvl ${p1Active.level}) and ${player2Id} (${p2Active.name} Lvl ${p2Active.level})!`],
        turnNumber: 1,
        p1Action: null,
        p2Action: null,
        actionsReceived: 0,
        p1MustSwitch: false,
        p2MustSwitch: false,
        participants: {
            [player1Id]: new Set([p1Active.uniqueId]),
            [player2Id]: new Set([p2Active.uniqueId])
        },
        ended: false,
    };
    gameState.addBattle(battleId, battleData);

    // Update player states NOW
    gameState.updatePlayer(player1Id, { inBattle: true, currentBattleId: battleId, activeGenmonIndex: p1ActiveIndex });
    gameState.updatePlayer(player2Id, { inBattle: true, currentBattleId: battleId, activeGenmonIndex: p2ActiveIndex });
    // Update local references if they exist
    if (player1) { player1.inBattle = true; player1.currentBattleId = battleId; player1.activeGenmonIndex = p1ActiveIndex; }
    if (player2) { player2.inBattle = true; player2.currentBattleId = battleId; player2.activeGenmonIndex = p2ActiveIndex; }

    const battleStartData = {
        type: 'DUEL_START',
        payload: {
            battleId: battleId,
            player1: { id: player1Id, genmon: p1Active },
            player2: { id: player2Id, genmon: p2Active },
            initialLog: battleData.log
        }
    };

    // Ensure WebSockets are open before sending
    let canBroadcast = false;
    if (player1.ws && player1.ws.readyState === WebSocket.OPEN) {
         player1.ws.send(JSON.stringify(battleStartData));
         canBroadcast = true; // At least one player is connected to get wss
    } else { console.error(`Duel Start: Could not send start data to ${player1Id}`); }
    if (player2.ws && player2.ws.readyState === WebSocket.OPEN) {
         player2.ws.send(JSON.stringify(battleStartData));
         canBroadcast = true;
    } else { console.error(`Duel Start: Could not send start data to ${player2Id}`); }

    if (canBroadcast) {
        // Use the WebSocket server instance from a connected player
        const wss = player1.ws?.server || player2.ws?.server;
        if (wss) {
            broadcast(wss, gameState.getAllPlayers(), { type: 'PLAYER_IN_BATTLE', payload: { playerIds: [player1Id, player2Id] } }, null);
        } else {
            console.error("Duel Start: Could not get WebSocket server instance for broadcasting.");
        }
    }

    requestPlayerAction(fasterPlayerId, battleId);
}

module.exports = {
    handleInitiateDuel,
    handleRespondDuel,
    // startDuel is called internally
};