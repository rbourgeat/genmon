const WebSocket = require('ws');
const gameState = require('./gameState');
const { sendInfo, broadcast, generateUniqueId } = require('./utils');
const { getPublicPlayerData, getPrivatePlayerData } = require('./player');
const { MAX_TEAM_SIZE, DUEL_MAX_DISTANCE } = require('./constants');
const {
    genmonData,
    moveData,
    calculateDamage,
    calculateCatchSuccess,
    createGenmonInstance,
} = require('../data/genmonData');

// --- Wild Battle ---
function startWildBattle(playerId) {
    const player = gameState.getPlayer(playerId);
    if (!player || player.inBattle || player.team.length === 0) return;

    const firstHealthyIndex = player.team.findIndex(g => g.currentHp > 0);
    if (firstHealthyIndex === -1) {
        sendInfo(player.ws, "All your Genmon have fainted!");
        return;
    }

    let activeIndex = player.activeGenmonIndex;
    if (player.team[activeIndex].currentHp <= 0) {
        activeIndex = firstHealthyIndex;
        gameState.updatePlayer(playerId, { activeGenmonIndex: activeIndex });
        // No need to send TEAM_UPDATE here, battle start will include active genmon
    }
    const playerActiveGenmon = player.team[activeIndex];


    const availableGenmonIds = Object.keys(genmonData);
    if (availableGenmonIds.length === 0) {
        console.error("No Genmon data available to start wild battle.");
        sendInfo(player.ws, "Error: No wild Genmon data found.");
        return;
    }
    const wildGenmonId = availableGenmonIds[Math.floor(Math.random() * availableGenmonIds.length)];
    const wildGenmonInstance = createGenmonInstance(wildGenmonId);
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
        turn: playerId, // Player usually goes first (add speed check later if needed)
        log: [`A wild ${wildGenmonInstance.name} appeared!`],
        turnNumber: 1,
        waitingForAction: playerId, // Set initial waiting player
        playerAction: null, // Stores player's action for the turn
        opponentAction: null, // Stores wild Genmon's action for the turn
        p1MustSwitch: false, // Track if player needs to switch
        ended: false,
    };
    gameState.addBattle(battleId, battleData);

    gameState.updatePlayer(playerId, { inBattle: true, currentBattleId: battleId, activeGenmonIndex: activeIndex }); // Ensure active index is updated if changed
    player.inBattle = true;
    player.currentBattleId = battleId;

    const battleStartData = {
        type: 'WILD_BATTLE_START',
        payload: {
            battleId: battleId,
            playerGenmon: playerActiveGenmon, // Send the correct active genmon
            opponentGenmon: wildGenmonInstance,
            initialLog: battleData.log
        }
    };

    player.ws.send(JSON.stringify(battleStartData));
    broadcast(player.ws.server, gameState.getAllPlayers(), { type: 'PLAYER_IN_BATTLE', payload: { playerIds: [playerId] } }, player.ws); // Exclude self

    requestPlayerAction(playerId, battleId);
}

// --- Duel (PvP) ---
function handleInitiateDuel(challengerId, targetId) {
    const challenger = gameState.getPlayer(challengerId);
    const target = gameState.getPlayer(targetId);

    if (!challenger || !target) return sendInfo(challenger?.ws, "Target player not found.");
    if (challengerId === targetId) return sendInfo(challenger.ws, "Cannot challenge yourself.");
    if (challenger.inBattle) return sendInfo(challenger.ws, "Cannot challenge while in battle.");
    if (target.inBattle) return sendInfo(challenger.ws, `${target.id} is already in a battle.`);
    if (challenger.team.length === 0 || !challenger.team.some(g => g.currentHp > 0)) return sendInfo(challenger.ws, "You need a healthy Genmon to battle.");
    if (target.team.length === 0 || !target.team.some(g => g.currentHp > 0)) return sendInfo(challenger.ws, `${target.id} has no healthy Genmon to battle.`);

    const distance = Math.abs(challenger.x - target.x) + Math.abs(challenger.y - target.y);
    if (distance > DUEL_MAX_DISTANCE) {
        return sendInfo(challenger.ws, "Target is too far away.");
    }

    target.ws.send(JSON.stringify({
        type: 'DUEL_REQUEST',
        payload: {
            challengerId: challengerId,
            challengerName: challengerId // Use name later
        }
    }));

    sendInfo(challenger.ws, `Duel request sent to ${targetId}.`);
}

function handleRespondDuel(responderId, challengerId, accepted) {
    const responder = gameState.getPlayer(responderId);
    const challenger = gameState.getPlayer(challengerId);

    if (!responder || !challenger) return;

    if (accepted) {
        if (responder.inBattle || challenger.inBattle || !responder.team.some(g => g.currentHp > 0) || !challenger.team.some(g => g.currentHp > 0)) {
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

    let p1ActiveIndex = player1.team.findIndex(g => g.currentHp > 0);
    if(p1ActiveIndex === -1) { console.error("P1 has no healthy genmon for duel start"); return; }
    // Don't update state here, wait until battle start update below

    let p2ActiveIndex = player2.team.findIndex(g => g.currentHp > 0);
     if(p2ActiveIndex === -1) { console.error("P2 has no healthy genmon for duel start"); return; }
     // Don't update state here

    const p1Active = player1.team[p1ActiveIndex];
    const p2Active = player2.team[p2ActiveIndex];

    const battleId = generateUniqueId();
    // Determine turn based on speed (will be re-evaluated each turn)
    const fasterPlayerId = p1Active.stats.spd >= p2Active.stats.spd ? player1Id : player2Id;

    const battleData = {
        id: battleId,
        type: 'PvP',
        player1Id: player1Id,
        player2Id: player2Id,
        p1GenmonUniqueId: p1Active.uniqueId,
        p2GenmonUniqueId: p2Active.uniqueId,
        turn: fasterPlayerId, // Who goes first in the first turn
        waitingForAction: fasterPlayerId, // Whose action we are waiting for initially
        log: [`Duel started between ${player1Id} (${p1Active.name}) and ${player2Id} (${p2Active.name})!`],
        turnNumber: 1,
        p1Action: null,
        p2Action: null,
        actionsReceived: 0,
        p1MustSwitch: false, // Track if player needs to switch
        p2MustSwitch: false,
        ended: false,
    };
    gameState.addBattle(battleId, battleData);

    // Update player states NOW (ensure active index is correct)
    gameState.updatePlayer(player1Id, { inBattle: true, currentBattleId: battleId, activeGenmonIndex: p1ActiveIndex });
    gameState.updatePlayer(player2Id, { inBattle: true, currentBattleId: battleId, activeGenmonIndex: p2ActiveIndex });
    player1.inBattle = true; player1.currentBattleId = battleId; // Also update local refs used in this scope
    player2.inBattle = true; player2.currentBattleId = battleId;

    const battleStartData = {
        type: 'DUEL_START',
        payload: {
            battleId: battleId,
            player1: { id: player1Id, genmon: p1Active },
            player2: { id: player2Id, genmon: p2Active },
            initialLog: battleData.log
        }
    };

    player1.ws.send(JSON.stringify(battleStartData));
    player2.ws.send(JSON.stringify(battleStartData));

    broadcast(player1.ws.server, gameState.getAllPlayers(), { type: 'PLAYER_IN_BATTLE', payload: { playerIds: [player1Id, player2Id] } }, null); // Broadcast to ALL others

    requestPlayerAction(fasterPlayerId, battleId); // Request action from the faster player first
}


// --- Unified Battle Action Handling ---

function requestPlayerAction(playerId, battleId) {
    const battle = gameState.getBattle(battleId);
    const player = gameState.getPlayer(playerId);
    if (!battle || !player || battle.ended) return;

    // Ensure the player is actually in the battle
    const playerIsInBattle = (battle.type === 'PvP' && (playerId === battle.player1Id || playerId === battle.player2Id)) ||
                             (battle.type === 'PvE' && playerId === battle.playerId);
    if (!playerIsInBattle) {
        console.error(`Action requested from ${playerId} who is not in battle ${battleId}`);
        return;
    }

    battle.waitingForAction = playerId; // Set who we are waiting for

    const payload = {
        battleId: battleId,
        playerId: playerId, // ID of player whose action is needed
        turnNumber: battle.turnNumber
    };
    const message = { type: 'REQUEST_ACTION', payload };

    if (player.ws && player.ws.readyState === WebSocket.OPEN) {
         player.ws.send(JSON.stringify(message));
         console.log(`Sent REQUEST_ACTION to ${playerId} for battle ${battleId}`); // Added log
    } else {
         console.error(`Cannot send REQUEST_ACTION to ${playerId}, WebSocket not open.`);
         // Disconnect handler should manage battle termination if WS is closed.
         return;
    }

    // Inform the opponent(s) who's turn it is
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

    if (!battle || !player || battle.ended) {
        console.log(`Action rejected for non-existent, ended, or playerless battle. Battle: ${battleId}, Player: ${playerId}`);
        return;
    }

    // Validate swap action
    if (action.type === 'swap') {
        if (action.teamIndex < 0 || action.teamIndex >= player.team.length) {
            sendInfo(player.ws, "Invalid Genmon index for swap.");
            requestPlayerAction(playerId, battleId); // Re-request action
            return;
        }
        const targetGenmon = player.team[action.teamIndex];
        const currentGenmonUniqueId = (battle.type === 'PvP')
            ? (playerId === battle.player1Id ? battle.p1GenmonUniqueId : battle.p2GenmonUniqueId)
            : battle.playerGenmonUniqueId;
        const currentGenmon = player.team.find(g => g.uniqueId === currentGenmonUniqueId);

        if (!currentGenmon) {
             console.error(`Error: Cannot find current Genmon (${currentGenmonUniqueId}) for player ${playerId} in battle ${battleId}`);
             sendInfo(player.ws, "Error processing swap: Cannot find your active Genmon.");
             // Potentially end battle or request action again? Re-request for now.
             requestPlayerAction(playerId, battleId);
             return;
         }

        if (targetGenmon.uniqueId === currentGenmon.uniqueId) {
            sendInfo(player.ws, `${targetGenmon.name} is already in battle.`);
            requestPlayerAction(playerId, battleId);
            return;
        }
        if (targetGenmon.currentHp <= 0) {
            sendInfo(player.ws, `${targetGenmon.name} has fainted and cannot battle.`);
             // Check if this was a forced swap - if so, player must pick *another*
            const mustSwitch = (battle.type === 'PvP' && ((playerId === battle.player1Id && battle.p1MustSwitch) || (playerId === battle.player2Id && battle.p2MustSwitch))) ||
                               (battle.type === 'PvE' && playerId === battle.playerId && battle.p1MustSwitch);
            if (mustSwitch) {
                 // Send REQUEST_SWITCH again, prompting user to pick a different one
                 player.ws.send(JSON.stringify({ type: 'REQUEST_SWITCH', payload: { battleId: battleId, reason: "That Genmon fainted! Choose another."} }));
                 battle.waitingForAction = playerId; // Still waiting for swap from this player
            } else {
                 requestPlayerAction(playerId, battleId); // Re-request normal action if swap was voluntary
            }
            return;
        }
    }

    // --- Store Action ---
    if (battle.type === 'PvP') {
        if (playerId === battle.player1Id && !battle.p1Action) {
            battle.p1Action = action;
            battle.actionsReceived++;
            if (battle.p1MustSwitch && action.type === 'swap') battle.p1MustSwitch = false;
        } else if (playerId === battle.player2Id && !battle.p2Action) {
            battle.p2Action = action;
            battle.actionsReceived++;
            if (battle.p2MustSwitch && action.type === 'swap') battle.p2MustSwitch = false;
        } else {
            console.log(`Player ${playerId} sent duplicate or unexpected action for battle ${battleId} turn ${battle.turnNumber}`);
            sendInfo(player.ws, "Action already received or unexpected.");
            return;
        }

        // Check if we proceed
        if (battle.actionsReceived === 2) {
            battle.waitingForAction = null; // Stop specific waiting
            processBattleTurn(battleId);
        } else if (battle.actionsReceived === 1) {
            // Still waiting for the other player
            const waitingFor = playerId === battle.player1Id ? battle.player2Id : battle.player1Id;
            battle.waitingForAction = waitingFor; // Set state correctly
            sendInfo(player.ws, "Action received. Waiting for opponent..."); // Inform acting player
            console.log(`Battle ${battleId} Turn ${battle.turnNumber}: Received action from ${playerId}, waiting for ${waitingFor}`);
            requestPlayerAction(waitingFor, battleId);

            // Optional: Inform the waiting player that the opponent acted
            const opponent = gameState.getPlayer(waitingFor);
             if(opponent?.ws?.readyState === WebSocket.OPEN) {
                 sendInfo(opponent.ws, `${playerId} has selected their action.`);
             }
        }
    } else { // PvE
        if (battle.waitingForAction !== playerId) {
             console.log(`Invalid action attempt by ${playerId} for PvE battle ${battleId}. Waiting for ${battle.waitingForAction}. Action: ${action.type}`);
             sendInfo(player.ws, "It's not your turn to act!");
             return;
         }
        battle.waitingForAction = null;
        battle.playerAction = action;
        if (battle.p1MustSwitch && action.type === 'swap') battle.p1MustSwitch = false;
        processBattleTurn(battleId);
    }
}


// --- Turn Processing ---
function processBattleTurn(battleId) {
    const battle = gameState.getBattle(battleId);
    if (!battle || battle.ended) return;

    console.log(`Processing Turn ${battle.turnNumber} for Battle ${battleId}`);

    const turnLog = [];
    const turnUpdates = {
        battleId: battleId,
        logUpdate: [],
        p1GenmonUpdate: null,
        p2GenmonUpdate: null,
        swapOccurred: false,
    };

    let player1, player2, p1Genmon, p2Genmon;
    let action1, action2;

    // --- Get Current Battle Participants ---
    if (battle.type === 'PvP') {
        player1 = gameState.getPlayer(battle.player1Id);
        player2 = gameState.getPlayer(battle.player2Id);
        if (!player1 || !player2) { console.error(`Player missing in PvP battle ${battleId}`); return handleBattleEnd(battleId, null, null, false, true); } // Disconnected = forfeit

        p1Genmon = player1.team.find(g => g.uniqueId === battle.p1GenmonUniqueId);
        p2Genmon = player2.team.find(g => g.uniqueId === battle.p2GenmonUniqueId);
        if (!p1Genmon || !p2Genmon) {
             console.error(`Active Genmon missing in PvP battle ${battleId}. P1 found: ${!!p1Genmon}, P2 found: ${!!p2Genmon}`);
             const winner = !p1Genmon ? battle.player2Id : battle.player1Id;
             const loser = !p1Genmon ? battle.player1Id : battle.player2Id;
             return handleBattleEnd(battleId, winner, loser, false, true); // Error = forfeit
         }
        action1 = battle.p1Action;
        action2 = battle.p2Action;
    } else { // PvE
        player1 = gameState.getPlayer(battle.playerId);
        if (!player1) { console.error(`Player missing in PvE battle ${battleId}`); return handleBattleEnd(battleId, null, null, false, true); } // Disconnected = forfeit

        p1Genmon = player1.team.find(g => g.uniqueId === battle.playerGenmonUniqueId);
        p2Genmon = battle.wildGenmon;
        if (!p1Genmon || !p2Genmon) {
            console.error(`Active Genmon missing in PvE battle ${battleId}. Player found: ${!!p1Genmon}, Wild found: ${!!p2Genmon}`);
            const loser = !p1Genmon ? player1.id : null;
            const winner = !p2Genmon ? player1.id : null;
             return handleBattleEnd(battleId, winner, loser, false, true); // Error = forfeit
        }

        action1 = battle.playerAction;
        let wildShouldAct = false;
        if (action1.type === 'move') { wildShouldAct = true; }
        else if (action1.type === 'swap') { wildShouldAct = true; }
        else if (action1.type === 'catch') { if (!calculateCatchSuccess(p2Genmon)) { wildShouldAct = true; } }
        else if (action1.type === 'flee') { if (Math.random() >= 0.6) { wildShouldAct = true; } } // Flee fail

        if (wildShouldAct && p2Genmon.currentHp > 0 && p2Genmon.moves && p2Genmon.moves.length > 0) {
             const wildMoveName = p2Genmon.moves[Math.floor(Math.random() * p2Genmon.moves.length)];
             action2 = { type: 'move', moveName: wildMoveName };
             battle.opponentAction = action2;
        } else {
             action2 = null; battle.opponentAction = null;
        }
    }

     // --- Determine Action Order ---
     let firstActorId, secondActorId;
     let firstAction, secondAction;
     let firstGenmon, secondGenmon;
     let firstIsSwap = false, secondIsSwap = false;

     const getActionPriority = (action) => (action?.type === 'swap' ? 6 : (moveData[action?.moveName]?.priority || 0));
     const getGenmonSpeed = (genmon) => genmon?.stats?.spd || 0;

     const p1Id = battle.type === 'PvP' ? battle.player1Id : battle.playerId;
     const p2Id = battle.type === 'PvP' ? battle.player2Id : 'wild';

     const priority1 = getActionPriority(action1);
     const priority2 = getActionPriority(action2);
     const speed1 = getGenmonSpeed(p1Genmon);
     const speed2 = getGenmonSpeed(p2Genmon);

     if (priority1 > priority2) { firstActorId = p1Id; secondActorId = p2Id; }
     else if (priority2 > priority1) { firstActorId = p2Id; secondActorId = p1Id; }
     else { if (speed1 >= speed2) { firstActorId = p1Id; secondActorId = p2Id; }
            else { firstActorId = p2Id; secondActorId = p1Id; }
     }

     if (firstActorId === p1Id) {
         firstAction = action1; firstGenmon = p1Genmon; firstIsSwap = action1?.type === 'swap';
         secondAction = action2; secondGenmon = p2Genmon; secondIsSwap = action2?.type === 'swap';
     } else {
         firstAction = action2; firstGenmon = p2Genmon; firstIsSwap = action2?.type === 'swap';
         secondAction = action1; secondGenmon = p1Genmon; secondIsSwap = action1?.type === 'swap';
     }


    // --- Execute Actions ---
    let battleShouldEnd = false;
    let winnerId = null;
    let loserId = null;
    let fled = false; // Local variable for this turn
    let caught = false; // Local variable for this turn
    let forfeited = false; // Default to false, set by disconnect or explicit forfeit later
    let skipSecondAction = false;

    // --- Execute Action Helper ---
    const executeAction = (actorId, actorAction, currentActorGenmon, currentTargetGenmon, targetId) => {
        let actionLog = [];
        let hpChangedActor = null;
        let hpChangedTarget = null;
        let targetFainted = false;
        let actorSwappedOut = null; // Store the new Genmon if swapped
        let actionResult = { success: true };

        const actorPlayer = gameState.getPlayer(actorId); // Might be null for 'wild'

        if (!currentActorGenmon || currentActorGenmon.currentHp <= 0) {
            actionLog.push(`${currentActorGenmon?.name || actorId} cannot act (fainted).`);
            return { log: actionLog, hpChangedActor, hpChangedTarget, targetFainted, actorSwappedOut, result: actionResult };
        }
         if (!actorAction) {
             actionLog.push(`${actorId} had no action selected!`);
             return { log: actionLog, hpChangedActor, hpChangedTarget, targetFainted, actorSwappedOut, result: actionResult };
         }

        switch (actorAction.type) {
            case 'swap':
                if (!actorPlayer) { actionLog.push(`Wild ${currentActorGenmon.name} tried to swap?!`); break; }
                const swapIndex = actorAction.teamIndex;
                const newGenmon = actorPlayer.team[swapIndex];
                if (newGenmon.currentHp <= 0) { actionLog.push(`${actorId} tried to swap to fainted ${newGenmon.name}!`); actionResult.success = false; break; }
                actionLog.push(`${actorId} swaps out ${currentActorGenmon.name} for ${newGenmon.name}!`);
                if (battle.type === 'PvP') { if (actorId === battle.player1Id) battle.p1GenmonUniqueId = newGenmon.uniqueId; else battle.p2GenmonUniqueId = newGenmon.uniqueId; }
                else { battle.playerGenmonUniqueId = newGenmon.uniqueId; }
                actorSwappedOut = newGenmon; turnUpdates.swapOccurred = true;
                if (actorId === p1Id) turnUpdates.p1GenmonUpdate = { ...newGenmon }; else turnUpdates.p2GenmonUpdate = { ...newGenmon };
                break;
            case 'move':
                const move = moveData[actorAction.moveName];
                if (!move || !currentActorGenmon.moves.includes(actorAction.moveName)) { actionLog.push(`${actorId} tried an invalid move: ${actorAction.moveName}.`); break; }
                if (!currentTargetGenmon || currentTargetGenmon.currentHp <= 0) { actionLog.push(`${currentActorGenmon.name} targets the fainted ${currentTargetGenmon?.name || targetId}!`); break; }
                actionLog.push(`${currentActorGenmon.name} used ${actorAction.moveName}!`);
                const damageResult = calculateDamage(currentActorGenmon, currentTargetGenmon, move);
                if (damageResult.damage > 0) {
                    currentTargetGenmon.currentHp = Math.max(0, currentTargetGenmon.currentHp - damageResult.damage);
                    hpChangedTarget = targetId; actionLog.push(`It dealt ${damageResult.damage} damage to ${currentTargetGenmon.name}.`);
                    if (damageResult.effectivenessMessage) { actionLog.push(damageResult.effectivenessMessage); }
                    if (currentTargetGenmon.currentHp <= 0) { targetFainted = true; actionLog.push(`${currentTargetGenmon.name} fainted!`); }
                } else if (damageResult.effectivenessMessage) { actionLog.push(damageResult.effectivenessMessage); }
                else if (move.power > 0) { actionLog.push(`But it failed!`); }
                else { actionLog.push(`${currentActorGenmon.name} used ${actorAction.moveName}.`); }
                break;
            case 'catch':
                if (battle.type === 'PvE' && actorId === battle.playerId) {
                    actionLog.push(`${actorId} threw a Catch Device!`);
                    actionResult.success = calculateCatchSuccess(p2Genmon); // Target wild
                    if (actionResult.success) {
                        actionLog.push(`Gotcha! ${p2Genmon.name} was caught!`); caught = true; // Set local 'caught'
                        const player = gameState.getPlayer(actorId);
                        if (player.team.length < MAX_TEAM_SIZE) { /* Add to team logic */
                            const caughtInstance = JSON.parse(JSON.stringify(p2Genmon)); caughtInstance.uniqueId = generateUniqueId(); player.team.push(caughtInstance); gameState.updatePlayer(actorId, { team: player.team }); sendInfo(player.ws, `${caughtInstance.name} added to your team.`); player.ws.send(JSON.stringify({ type: 'TEAM_UPDATE', payload: getPrivatePlayerData(actorId) }));
                        } else { /* Team full logic */ actionLog.push(`But ${actorId}'s team is full! ${p2Genmon.name} was not added.`); sendInfo(player.ws, `Team is full. ${p2Genmon.name} was not added.`); }
                        battleShouldEnd = true; skipSecondAction = true;
                    } else { actionLog.push(`Oh no! The Genmon broke free!`); }
                } else { actionLog.push(`${actorId} tried to catch, but cannot!`); }
                break;
            case 'flee':
                if (battle.type === 'PvE' && actorId === battle.playerId) {
                    actionLog.push(`${actorId} attempts to flee...`); actionResult.success = Math.random() < 0.6;
                    if (actionResult.success) {
                        actionLog.push("Got away safely!"); fled = true; // Set local 'fled'
                        battleShouldEnd = true; skipSecondAction = true; loserId = actorId;
                    } else { actionLog.push("Couldn't get away!"); }
                } else if (battle.type === 'PvP') { actionLog.push(`${actorId} tried to flee a Trainer battle!`); }
                break;
            default: actionLog.push(`${actorId} did something unexpected: ${actorAction.type}`); break;
        }
        return { log: actionLog, hpChangedActor, hpChangedTarget, targetFainted, actorSwappedOut, result: actionResult };
    };
    // --- End Execute Action Helper ---


    // --- Execute First Action ---
    let firstTargetGenmonRef = (firstActorId === p1Id) ? secondGenmon : firstGenmon;
    let firstTargetId = (firstActorId === p1Id) ? p2Id : p1Id;
    const action1Result = executeAction(firstActorId, firstAction, firstGenmon, firstTargetGenmonRef, firstTargetId);
    turnLog.push(...action1Result.log);

    let currentFirstActorGenmon = action1Result.actorSwappedOut ? action1Result.actorSwappedOut : firstGenmon;
    let currentSecondActorGenmon = secondGenmon;
    if (action1Result.actorSwappedOut) {
        if (firstActorId === p1Id) p1Genmon = currentFirstActorGenmon;
        else p2Genmon = currentFirstActorGenmon;
    }

    if (action1Result.targetFainted) {
         battleShouldEnd = checkForBattleEndCondition(battleId, firstActorId, firstTargetId);
         if (battleShouldEnd) { winnerId = firstActorId; loserId = firstTargetId; skipSecondAction = true; }
         else { markPlayerForSwitch(battleId, firstTargetId); }
    } else if (battleShouldEnd) { skipSecondAction = true; } // Catch/flee ended it

    // --- Execute Second Action ---
    if (!skipSecondAction) {
        let secondTargetGenmonRef = (secondActorId === p1Id) ? p2Genmon : p1Genmon;
        let secondTargetId = (secondActorId === p1Id) ? p2Id : p1Id;
        const action2Result = executeAction(secondActorId, secondAction, currentSecondActorGenmon, secondTargetGenmonRef, secondTargetId);
        turnLog.push(...action2Result.log);
        if (action2Result.actorSwappedOut) {
            currentSecondActorGenmon = action2Result.actorSwappedOut;
            if (secondActorId === p1Id) p1Genmon = currentSecondActorGenmon;
            else p2Genmon = currentSecondActorGenmon;
        }
        if (action2Result.targetFainted) {
            battleShouldEnd = checkForBattleEndCondition(battleId, secondActorId, secondTargetId);
            if (battleShouldEnd) { winnerId = secondActorId; loserId = secondTargetId; }
            else { markPlayerForSwitch(battleId, secondTargetId); }
        }
    }


    // --- Post-Turn Updates ---
    battle.log.push(...turnLog);
    turnUpdates.logUpdate = turnLog;
    if (!turnUpdates.p1GenmonUpdate) { turnUpdates.p1GenmonUpdate = p1Genmon ? { ...p1Genmon } : null; }
    if (!turnUpdates.p2GenmonUpdate) { turnUpdates.p2GenmonUpdate = p2Genmon ? { ...p2Genmon } : null; }
    const updateMessage = { type: 'BATTLE_UPDATE', payload: turnUpdates };
    const updateString = JSON.stringify(updateMessage);
    if (battle.type === 'PvP') {
        if (player1?.ws?.readyState === WebSocket.OPEN) player1.ws.send(updateString);
        if (player2?.ws?.readyState === WebSocket.OPEN) player2.ws.send(updateString);
    } else {
        if (player1?.ws?.readyState === WebSocket.OPEN) player1.ws.send(updateString);
    }
    console.log(`Battle ${battleId} Turn End Log:`, turnLog.join(' | '));


    // --- Handle Battle End OR Proceed ---
    if (battleShouldEnd) {
        const finalWinnerId = (winnerId === 'wild') ? null : winnerId;
        const finalLoserId = (loserId === 'wild') ? null : loserId;
        // Pass the local `fled`, `forfeited`, `caught` variables correctly
        handleBattleEnd(battleId, finalWinnerId, finalLoserId, fled, forfeited, caught);
    } else {
         // --- Next Turn/Switch Logic ---
         battle.p1Action = null; battle.p2Action = null; battle.playerAction = null; battle.opponentAction = null;
         battle.actionsReceived = 0; battle.turnNumber++;
         let nextPlayerToAct = null;
         const currentP1 = gameState.getPlayer(battle.player1Id);
         const currentP2 = battle.type === 'PvP' ? gameState.getPlayer(battle.player2Id) : null;
         let p1CanSwitch = false;
         if (battle.p1MustSwitch && currentP1) {
            p1CanSwitch = currentP1.team.some(g => g.currentHp > 0);
            if (!p1CanSwitch) { handleBattleEnd(battleId, battle.type === 'PvP' ? battle.player2Id : null, battle.player1Id, false, true); return; } // P1 forfeit
         }
         let p2CanSwitch = false;
         if (battle.p2MustSwitch && currentP2 && battle.type === 'PvP') {
            p2CanSwitch = currentP2.team.some(g => g.currentHp > 0);
            if (!p2CanSwitch) { handleBattleEnd(battleId, battle.player1Id, battle.player2Id, false, true); return; } // P2 forfeit
         }

         if (battle.p1MustSwitch || battle.p2MustSwitch) { // Request switches
            const speed1 = getGenmonSpeed(p1Genmon); const speed2 = getGenmonSpeed(p2Genmon);
            if (battle.p1MustSwitch && battle.p2MustSwitch) { nextPlayerToAct = (speed1 >= speed2) ? p1Id : p2Id; }
            else if (battle.p1MustSwitch) { nextPlayerToAct = p1Id; }
            else { nextPlayerToAct = p2Id; } // p2MustSwitch is true
            console.log(`Battle ${battleId}: Requesting switch from ${nextPlayerToAct}.`);
            const playerToAsk = gameState.getPlayer(nextPlayerToAct);
            if (playerToAsk?.ws) { playerToAsk.ws.send(JSON.stringify({ type: 'REQUEST_SWITCH', payload: { battleId: battleId, reason: "Your Genmon fainted!"} })); battle.waitingForAction = nextPlayerToAct; }
            else { console.error(`Cannot request switch from ${nextPlayerToAct}, WS unavailable.`); }
         } else { // Request next actions
             const currentSpeed1 = getGenmonSpeed(p1Genmon); const currentSpeed2 = getGenmonSpeed(p2Genmon);
             if (battle.type === 'PvP') { nextPlayerToAct = (currentSpeed1 >= currentSpeed2) ? battle.player1Id : battle.player2Id; }
             else { nextPlayerToAct = battle.playerId; } // PvE player goes first
             requestPlayerAction(nextPlayerToAct, battleId);
         }
    }
}

// Helper to check if a player losing their current Genmon ends the battle
function checkForBattleEndCondition(battleId, actorId, targetId) {
     const battle = gameState.getBattle(battleId);
     if (!battle) return true;
     const targetPlayerId = (targetId === 'wild') ? null : targetId;
     if (!targetPlayerId) return false;
     const targetPlayer = gameState.getPlayer(targetPlayerId);
     if (!targetPlayer) return true;
     const faintedGenmonId = (targetId === battle.player1Id) ? battle.p1GenmonUniqueId : battle.p2GenmonUniqueId;
     const faintedGenmon = targetPlayer.team.find(g => g.uniqueId === faintedGenmonId);
     if (!faintedGenmon || faintedGenmon.currentHp > 0) {
         console.warn(`Battle ${battleId}: Checking end condition for ${targetPlayerId}, but Genmon ${faintedGenmonId} HP is ${faintedGenmon?.currentHp}.`);
         // If the genmon wasn't found or isn't fainted, the battle shouldn't end based on *this* faint.
         return false;
     }
     // Check if *any* other genmon is healthy
     const hasMoreGenmon = targetPlayer.team.some(g => g.uniqueId !== faintedGenmonId && g.currentHp > 0);
     return !hasMoreGenmon; // Ends if no other healthy genmon exists
}


// Helper to mark a player as needing to switch
function markPlayerForSwitch(battleId, playerIdToSwitch) {
     const battle = gameState.getBattle(battleId);
     if (!battle || playerIdToSwitch === 'wild') return;
     const player = gameState.getPlayer(playerIdToSwitch);
      if (!player) return;
     const canSwitch = player.team.some(g => g.currentHp > 0);
     if (!canSwitch) { console.log(`Battle ${battleId}: ${playerIdToSwitch} fainted but has no more Genmon.`); return; } // Don't mark if they can't switch

     if (battle.type === 'PvP') {
         if (playerIdToSwitch === battle.player1Id) { battle.p1MustSwitch = true; }
         else if (playerIdToSwitch === battle.player2Id) { battle.p2MustSwitch = true; }
     } else { // PvE
         if (playerIdToSwitch === battle.playerId) { battle.p1MustSwitch = true; }
     }
      if(battle.p1MustSwitch || battle.p2MustSwitch) {
           console.log(`Battle ${battleId}: Marked ${playerIdToSwitch} as needing to switch.`);
      }
}

function handleBattleEnd(battleId, winnerId, loserId, fled = false, forfeited = false, caught = false) {
    const battle = gameState.getBattle(battleId);
    if (!battle || battle.ended) {
         console.log(`Attempted to end already ended or non-existent battle: ${battleId}`);
         return;
    }
    battle.ended = true; // Mark ended immediately

    console.log(`Ending battle ${battleId}. Winner: ${winnerId}, Loser: ${loserId}, Fled: ${fled}, Forfeit: ${forfeited}, Caught: ${caught}`);

    let finalMessage = "";
    let winnerName = winnerId || "???";
    let loserName = loserId || "???";
    const wildName = battle.wildGenmon?.name || "Wild Genmon";

    if (battle.type === 'PvP') {
        const winner = gameState.getPlayer(winnerId);
        const loser = gameState.getPlayer(loserId);
        winnerName = winner?.id || winnerId || "Winner";
        loserName = loser?.id || loserId || "Loser";

        if (winnerId && loserId) {
            // Use forfeited flag (usually means disconnect or error)
            finalMessage = forfeited
                ? `${loserName} forfeited or disconnected! ${winnerName} wins!`
                : `${winnerName} defeated ${loserName}!`; // Normal win
        } else if (winnerId) { // Opponent likely disconnected
            finalMessage = `${winnerName} wins the duel due to opponent disconnect or error!`;
            if (!loserId) loserId = winnerId === battle.player1Id ? battle.player2Id : battle.player1Id;
            forfeited = true; // Mark as forfeit if only winner is known
        } else if (loserId) { // This player likely disconnected
            finalMessage = `${loserName} lost the duel due to disconnect or error!`;
            if(!winnerId) winnerId = loserId === battle.player1Id ? battle.player2Id : battle.player1Id;
            forfeited = true; // Mark as forfeit if only loser is known
        } else { // Should not happen ideally
            finalMessage = "The duel ended unexpectedly.";
             winnerId = winnerId || null;
             loserId = loserId || (winnerId === battle.player1Id ? battle.player2Id : battle.player1Id);
             if (!winnerId && !loserId && battle.player1Id && battle.player2Id) { loserId = battle.player1Id; }
        }

    } else { // PvE
        const playerId = battle.playerId;
        const player = gameState.getPlayer(playerId);
        winnerName = playerId;
        loserName = playerId;

        if (caught) {
            finalMessage = `${wildName} was caught!`;
            winnerId = playerId; loserId = null;
        } else if (winnerId === playerId) { // Player won normally
            finalMessage = `You defeated the wild ${wildName}!`;
            loserId = null;
        } else { // Player lost, fled, or disconnected
            loserId = playerId; winnerId = null;
            // ***** USE DEDICATED fled PARAMETER *****
            if (fled) {
                finalMessage = `Got away safely from ${wildName}.`;
            // ***** CHECK forfeited FOR DISCONNECT *****
            } else if (forfeited) { // If not fled, but forfeited is true, it's likely a disconnect
                 finalMessage = `Disconnected from battle with ${wildName}.`;
            } else { // Player lost normally (all Genmon fainted)
                finalMessage = `You were defeated by the wild ${wildName}!`;
                 if (player) sendInfo(player.ws, "You blacked out!");
            }
        }
    }

    // Add final message to log if distinct
    if (finalMessage && !battle.log.some(msg => msg.includes(finalMessage.substring(0, 20)))) {
        battle.log.push(finalMessage);
    } else if (!finalMessage && !battle.log.some(msg => msg.includes("Battle ended"))) {
         battle.log.push("Battle ended.");
     }


    const battleEndData = {
        type: 'BATTLE_END',
        payload: {
            battleId: battleId,
            battleType: battle.type,
            winnerId: winnerId,
            loserId: loserId,
            forfeited: forfeited, // Keep forfeited status
            caught: caught,
            fled: fled, // Include fled status in payload for client? Optional.
            finalLog: battle.log
        }
    };
     const battleEndString = JSON.stringify(battleEndData);

    const playerIdsInvolved = battle.type === 'PvP' ? [battle.player1Id, battle.player2Id] : [battle.playerId];
    let wsForBroadcast = null;

    playerIdsInvolved.forEach(pId => {
        const player = gameState.getPlayer(pId);
        if (player) {
            gameState.updatePlayer(pId, { inBattle: false, currentBattleId: null });
            // Update local refs just in case, though gameState update should be sufficient
            player.inBattle = false;
            player.currentBattleId = null;

            if (player.ws && player.ws.readyState === WebSocket.OPEN) {
                 wsForBroadcast = player.ws.server; // Grab wss reference
                 player.ws.send(battleEndString);
                 // Send final team state (includes HP updates from battle)
                 player.ws.send(JSON.stringify({ type: 'TEAM_UPDATE', payload: getPrivatePlayerData(pId) }));
             }
        }
    });

    gameState.removeBattle(battleId);

    // Notify others that these players are no longer in battle
    if (wsForBroadcast) {
        broadcast(wsForBroadcast, gameState.getAllPlayers(), { type: 'PLAYER_BATTLE_END', payload: { playerIds: playerIdsInvolved } }, null);
    } else {
        console.log(`Battle ${battleId} ended, but could not find WebSocket server instance to broadcast PLAYER_BATTLE_END.`);
    }


    console.log(`Battle ${battleId} officially ended and removed. Final message logged: ${finalMessage}`);
}

// --- Handle Player Disconnect during Battle ---
function handlePlayerDisconnectBattle(playerId) {
     const player = gameState.getPlayer(playerId);
     let battleId = player?.currentBattleId;
     let battle = battleId ? gameState.getBattle(battleId) : null;

     if (!battle) { // Search if not found via player state
         const allBattles = gameState.getAllBattles();
         for (const id in allBattles) { const b = allBattles[id]; if (!b.ended && ((b.type === 'PvP' && (b.player1Id === playerId || b.player2Id === playerId)) || (b.type === 'PvE' && b.playerId === playerId))) { battle = b; battleId = id; break; } }
     }

     if (!battle || battle.ended) { console.log(`Disconnect: Battle for player ${playerId} not found or already ended.`); return; }
     console.log(`Handling disconnect for player ${playerId} during battle ${battleId}`);

     if (battle.type === 'PvP') {
         const opponentId = battle.player1Id === playerId ? battle.player2Id : battle.player1Id;
         handleBattleEnd(battleId, opponentId, playerId, false, true, false); // fled=false, forfeited=true, caught=false
     } else { // PvE
         handleBattleEnd(battleId, null, playerId, false, true, false); // fled=false, forfeited=true, caught=false
     }
}


module.exports = {
    startWildBattle,
    handleInitiateDuel,
    handleRespondDuel,
    startDuel,
    requestPlayerAction,
    handlePlayerAction,
    handleBattleEnd,
    handlePlayerDisconnectBattle,
};