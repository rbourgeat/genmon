// --- FILE: ./game/battle/actions.js ---
const WebSocket = require('ws');
const gameState = require('../gameState');
const { sendInfo } = require('../utils');
// Import the whole turn module
const turn = require('./turn');
const { MAX_TEAM_SIZE } = require('../constants');

// --- Action Handling ---

function requestPlayerAction(playerId, battleId) {
    const battle = gameState.getBattle(battleId);
    const player = gameState.getPlayer(playerId);
    if (!battle || battle.ended) {
        console.log(`Action Request rejected: Battle ${battleId} ended or doesn't exist.`);
        return;
    }
     if (!player) {
        console.error(`Action Request rejected: Player ${playerId} not found for battle ${battleId}.`);
        return;
    }

    const playerIsParticipant = (battle.type === 'PvP' && (playerId === battle.player1Id || playerId === battle.player2Id)) ||
                             (battle.type === 'PvE' && playerId === battle.playerId);
    if (!playerIsParticipant) {
        console.error(`Action requested from ${playerId} who is not in battle ${battleId}`);
        return;
    }

    battle.waitingForAction = playerId;

    const payload = {
        battleId: battleId,
        playerId: playerId,
        turnNumber: battle.turnNumber
    };
    const message = { type: 'REQUEST_ACTION', payload };

    if (player.ws && player.ws.readyState === WebSocket.OPEN) {
         player.ws.send(JSON.stringify(message));
         console.log(`Sent REQUEST_ACTION to ${playerId} for battle ${battleId} Turn ${battle.turnNumber}`);
    } else {
         console.error(`Cannot send REQUEST_ACTION to ${playerId} (WebSocket not open). Battle ${battleId}.`);
         return;
    }

    const waitingMessage = { type: 'INFO', payload: { message: `Waiting for ${playerId} to act...` } };
    if (battle.type === 'PvP') {
        const opponentId = (playerId === battle.player1Id) ? battle.player2Id : battle.player1Id;
        const opponent = gameState.getPlayer(opponentId);
        if (opponent?.ws?.readyState === WebSocket.OPEN) {
            opponent.ws.send(JSON.stringify(waitingMessage));
        }
    }
}

// Central handler for all player actions during battle
function handlePlayerAction(playerId, battleId, action) {
    const battle = gameState.getBattle(battleId);
    const player = gameState.getPlayer(playerId);

    if (!battle || battle.ended) {
        console.log(`Action rejected: Battle ${battleId} non-existent or ended. Player: ${playerId}, Action: ${action?.type}`);
        return;
    }
    if (!player || !player.ws) {
         console.log(`Action rejected: Player ${playerId} not found or no WebSocket. Battle ${battleId}, Action: ${action?.type}`);
         return;
    }

     const isWaitingForPlayer = battle.waitingForAction === playerId;
     const mustSwitch = (battle.type === 'PvP' && ((playerId === battle.player1Id && battle.p1MustSwitch) || (playerId === battle.player2Id && battle.p2MustSwitch))) ||
                      (battle.type === 'PvE' && playerId === battle.playerId && battle.p1MustSwitch);

     if (!isWaitingForPlayer && !(action.type === 'swap' && mustSwitch)) {
         console.log(`Player ${playerId} action ${action.type} received for battle ${battleId}, but not waiting for their action or switch.`);
         sendInfo(player.ws, `Not currently waiting for your action.`);
         return;
     }

    // Validate swap action details
    if (action.type === 'swap') {
        // ... (swap validation logic remains the same) ...
        if (action.teamIndex < 0 || !player.team || action.teamIndex >= player.team.length) {
            sendInfo(player.ws, "Invalid Genmon index for swap.");
            requestPlayerAction(playerId, battleId); // Re-request action
            return;
        }
        const targetGenmon = player.team[action.teamIndex];
        if (!targetGenmon) {
             sendInfo(player.ws, "Invalid target Genmon for swap.");
             requestPlayerAction(playerId, battleId);
             return;
        }

        const currentGenmonUniqueId = (battle.type === 'PvP')
            ? (playerId === battle.player1Id ? battle.p1GenmonUniqueId : battle.p2GenmonUniqueId)
            : battle.playerGenmonUniqueId;
        const currentGenmon = player.team.find(g => g && g.uniqueId === currentGenmonUniqueId);


        if (targetGenmon.uniqueId === currentGenmonUniqueId) {
            sendInfo(player.ws, `${targetGenmon.name} is already in battle.`);
            requestPlayerAction(playerId, battleId);
            return;
        }
        if (targetGenmon.currentHp <= 0) {
            sendInfo(player.ws, `${targetGenmon.name} has fainted and cannot battle.`);
            if (mustSwitch) {
                 player.ws.send(JSON.stringify({ type: 'REQUEST_SWITCH', payload: { battleId: battleId, reason: "That Genmon fainted! Choose another."} }));
                 battle.waitingForAction = playerId;
            } else {
                 requestPlayerAction(playerId, battleId);
            }
            return;
        }
    }

    // --- Store Action ---
    if (battle.type === 'PvP') {
        // ... (PvP action storage logic remains the same) ...
        let actionStored = false;
        if (playerId === battle.player1Id && !battle.p1Action) {
            battle.p1Action = action;
            battle.actionsReceived++;
            if (battle.p1MustSwitch && action.type === 'swap') battle.p1MustSwitch = false;
            actionStored = true;
        } else if (playerId === battle.player2Id && !battle.p2Action) {
            battle.p2Action = action;
            battle.actionsReceived++;
            if (battle.p2MustSwitch && action.type === 'swap') battle.p2MustSwitch = false;
            actionStored = true;
        }

        if (!actionStored) {
            console.log(`Player ${playerId} sent duplicate or unexpected action for PvP battle ${battleId} turn ${battle.turnNumber}. Action: ${action.type}`);
            sendInfo(player.ws, "Action already received or unexpected.");
            return;
        }

        if (battle.actionsReceived === 2) {
            battle.waitingForAction = null;
            // *** THE FIX: Call the function via the imported module object ***
            turn.processBattleTurn(battleId);
        } else if (battle.actionsReceived === 1) {
            const waitingForId = playerId === battle.player1Id ? battle.player2Id : battle.player1Id;
            sendInfo(player.ws, "Action received. Waiting for opponent...");
            console.log(`Battle ${battleId} Turn ${battle.turnNumber}: Received action from ${playerId}, requesting from ${waitingForId}`);
            requestPlayerAction(waitingForId, battleId);

            const opponent = gameState.getPlayer(waitingForId);
             if(opponent?.ws?.readyState === WebSocket.OPEN) {
                 sendInfo(opponent.ws, `${playerId} has selected their action.`);
             }
        }
    } else { // PvE
        battle.waitingForAction = null;
        battle.playerAction = action;
        if (battle.p1MustSwitch && action.type === 'swap') battle.p1MustSwitch = false;
        // *** THE FIX: Call the function via the imported module object ***
        turn.processBattleTurn(battleId);
    }
}


module.exports = {
    requestPlayerAction,
    handlePlayerAction,
};