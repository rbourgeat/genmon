// --- FILE: ./game/battle/turn.js ---
const WebSocket = require('ws');
const gameState = require('../gameState');
const { sendInfo } = require('../utils');
const genmonDataModule = require('../../data/genmonData');
const { MAX_TEAM_SIZE } = require('../constants');
const { getPrivatePlayerData } = require('../player');
const { handleBattleEnd } = require('./end');
const { markPlayerForSwitch, checkForBattleEndCondition } = require('./state');

// Helper functions (getMoveData, calculateDamageHelper, etc.) remain the same
function getMoveData() { return genmonDataModule?.moveData || {}; }
function calculateDamageHelper(attacker, defender, move) { return genmonDataModule?.calculateDamage ? genmonDataModule.calculateDamage(attacker, defender, move) : { damage: 0, effectivenessMessage: "Error: Damage calc unavailable" }; }
function calculateCatchSuccessHelper(wildGenmon) { return genmonDataModule?.calculateCatchSuccess ? genmonDataModule.calculateCatchSuccess(wildGenmon) : false; }
function calculateXpToNextLevelHelper(level) { const leveling = require('../leveling'); return leveling?.calculateXpToNextLevel ? leveling.calculateXpToNextLevel(level) : 100; }
function generateUniqueIdHelper() { if (genmonDataModule?.generateUniqueId) { return genmonDataModule.generateUniqueId(); } else { const utils = require('../utils'); return utils.generateUniqueId(); } }
function executeAction(actorId, actorAction, currentActorGenmon, currentTargetGenmon, targetId, battle, turnUpdates) { /* ... Omitted for brevity, no changes needed inside ... */
    let actionLog = [];
    let hpChangedTarget = null;
    let targetFainted = false;
    let actorSwappedOut = null;
    let actionResult = { success: true, endedBattle: false, caught: false, fled: false };
    const actorPlayer = actorId !== 'wild' ? gameState.getPlayer(actorId) : null;
    if (!currentActorGenmon) { actionLog.push(`${actorId}'s active Genmon is missing!`); actionResult.success = false; return { log: actionLog, hpChangedTargetId: null, targetFainted, actorSwappedOut, result: actionResult }; }
    if (!actorAction) { actionLog.push(`${actorId} had no action selected!`); actionResult.success = false; return { log: actionLog, hpChangedTargetId: null, targetFainted, actorSwappedOut, result: actionResult }; }
    if (currentActorGenmon.currentHp <= 0) { actionResult.success = false; return { log: actionLog, hpChangedTargetId: null, targetFainted, actorSwappedOut, result: actionResult }; }
    switch (actorAction.type) {
        case 'swap':
            if (!actorPlayer) { actionLog.push(`Wild ${currentActorGenmon.name} tried to swap?!`); actionResult.success = false; break; }
            const swapIndex = actorAction.teamIndex; const newGenmon = actorPlayer.team[swapIndex];
            actionLog.push(`${actorId} swaps out ${currentActorGenmon.name} for ${newGenmon.name} (Lvl ${newGenmon.level})!`);
            if (battle.participants[actorId]) { battle.participants[actorId].add(newGenmon.uniqueId); } else { console.warn(`Participant set missing for player ${actorId} in battle ${battle.id}`); }
            if (battle.type === 'PvP') { if (actorId === battle.player1Id) battle.p1GenmonUniqueId = newGenmon.uniqueId; else battle.p2GenmonUniqueId = newGenmon.uniqueId; } else { battle.playerGenmonUniqueId = newGenmon.uniqueId; }
            actorSwappedOut = newGenmon; turnUpdates.swapOccurred = true;
             if (actorId === (battle.type === 'PvP' ? battle.player1Id : battle.playerId)) { turnUpdates.p1GenmonUpdate = { ...newGenmon }; } else { turnUpdates.p2GenmonUpdate = { ...newGenmon }; }
            break;
        case 'move':
            const move = getMoveData()[actorAction.moveName];
            if (!move || !currentActorGenmon.moves || !currentActorGenmon.moves.includes(actorAction.moveName)) { console.error(`Invalid move data or genmon moves. Move: ${actorAction.moveName}, Genmon: ${currentActorGenmon.name}`, move, currentActorGenmon.moves); actionLog.push(`${actorId} tried an invalid move: ${actorAction.moveName}.`); actionResult.success = false; break; }
            if (!currentTargetGenmon) { actionLog.push(`${currentActorGenmon.name} targets nothing!`); actionResult.success = false; break; }
            if (currentTargetGenmon.currentHp <= 0) { actionLog.push(`${currentActorGenmon.name} targets the already fainted ${currentTargetGenmon?.name || targetId}!`); actionResult.success = false; break; }
            actionLog.push(`${currentActorGenmon.name} used ${actorAction.moveName}!`);
            const damageResult = calculateDamageHelper(currentActorGenmon, currentTargetGenmon, move);
            if (damageResult.effectivenessMessage) { actionLog.push(damageResult.effectivenessMessage); }
            if (damageResult.damage > 0) {
                const hpBefore = currentTargetGenmon.currentHp; currentTargetGenmon.currentHp = Math.max(0, currentTargetGenmon.currentHp - damageResult.damage); hpChangedTarget = targetId;
                actionLog.push(`It dealt ${damageResult.damage} damage to ${currentTargetGenmon.name}. (HP: ${hpBefore} -> ${currentTargetGenmon.currentHp})`);
                if (currentTargetGenmon.currentHp <= 0) { targetFainted = true; actionLog.push(`${currentTargetGenmon.name} fainted!`); }
            } else if (damageResult.effectivenessMessage === "But it missed!") { /* Handled */ }
            else if (move.power > 0 && damageResult.effectivenessMessage !== "Error: Damage calc unavailable") { if (!damageResult.effectivenessMessage?.includes("no effect")) { actionLog.push(`But it failed or had no effect!`); } }
            else if (damageResult.effectivenessMessage !== "Error: Damage calc unavailable") { actionLog.push(`${currentActorGenmon.name} used ${actorAction.moveName}.`); }
            break;
        case 'catch':
            if (battle.type === 'PvE' && actorId === battle.playerId) {
                actionLog.push(`${actorId} threw a Catch Device!`);
                if (!battle.wildGenmon) { actionLog.push("But there's no wild Genmon to catch!"); actionResult.success = false; break; }
                actionResult.success = calculateCatchSuccessHelper(battle.wildGenmon);
                if (actionResult.success) {
                    actionLog.push(`Gotcha! ${battle.wildGenmon.name} was caught!`); actionResult.caught = true; actionResult.endedBattle = true;
                    const player = gameState.getPlayer(actorId);
                    if (player) {
                        if (player.team.length < MAX_TEAM_SIZE) {
                            const caughtInstance = JSON.parse(JSON.stringify(battle.wildGenmon)); caughtInstance.uniqueId = generateUniqueIdHelper(); caughtInstance.xp = 0; caughtInstance.xpToNextLevel = calculateXpToNextLevelHelper(caughtInstance.level);
                            player.team.push(caughtInstance); gameState.updatePlayer(actorId, { team: player.team }); sendInfo(player.ws, `${caughtInstance.name} added to your team.`);
                             if (player.ws?.readyState === WebSocket.OPEN) { player.ws.send(JSON.stringify({ type: 'PLAYER_DATA_UPDATE', payload: getPrivatePlayerData(actorId) })); }
                        } else { actionLog.push(`But ${actorId}'s team is full! ${battle.wildGenmon.name} was not added.`); sendInfo(player.ws, `Team is full. ${battle.wildGenmon.name} was not added.`); }
                    }
                } else { actionLog.push(`Oh no! The Genmon broke free!`); }
            } else { actionLog.push(`${actorId} tried to catch, but cannot!`); actionResult.success = false; }
            break;
        case 'flee':
             if (battle.type === 'PvE' && actorId === battle.playerId) {
                actionLog.push(`${actorId} attempts to flee...`); actionResult.success = Math.random() < 0.6;
                if (actionResult.success) { actionLog.push("Got away safely!"); actionResult.fled = true; actionResult.endedBattle = true; } else { actionLog.push("Couldn't get away!"); }
            } else if (battle.type === 'PvP') { actionLog.push(`${actorId} tried to flee a Trainer battle!`); actionResult.success = false; } else { actionLog.push(`${actorId} tried to flee, but cannot!`); actionResult.success = false; }
            break;
        default: actionLog.push(`${actorId} did something unexpected: ${actorAction.type}`); actionResult.success = false; break;
    }
     if (hpChangedTarget) { if (hpChangedTarget === (battle.type === 'PvP' ? battle.player1Id : battle.playerId)) { turnUpdates.p1GenmonUpdate = { ...currentTargetGenmon }; } else { turnUpdates.p2GenmonUpdate = { ...currentTargetGenmon }; } }
    return { log: actionLog, hpChangedTargetId: hpChangedTarget, targetFainted, actorSwappedOut, result: actionResult };
}


// --- Turn Processing ---
function processBattleTurn(battleId) {
    const battle = gameState.getBattle(battleId);
    if (!battle || battle.ended) {
        console.log(`Turn Processing cancelled: Battle ${battleId} non-existent or already ended.`);
        return;
    }

    console.log(`Processing Turn ${battle.turnNumber} for Battle ${battleId}`);

    const turnLog = [];
    const turnUpdates = { battleId: battleId, logUpdate: [], p1GenmonUpdate: null, p2GenmonUpdate: null, swapOccurred: false };
    let player1, player2, p1Genmon, p2Genmon;
    let action1, action2;
    let p1Id, p2Id;

    // --- Get Participants ---
    if (battle.type === 'PvP') {
        player1 = gameState.getPlayer(battle.player1Id); player2 = gameState.getPlayer(battle.player2Id);
        p1Id = battle.player1Id; p2Id = battle.player2Id;
        if (!player1 || !player2) { return handleBattleEnd(battleId, !player1 ? battle.player2Id : battle.player1Id, !player1 ? battle.player1Id : battle.player2Id, false, true); }
        p1Genmon = player1.team.find(g => g && g.uniqueId === battle.p1GenmonUniqueId);
        p2Genmon = player2.team.find(g => g && g.uniqueId === battle.p2GenmonUniqueId);
        action1 = battle.p1Action; action2 = battle.p2Action;
    } else { // PvE
        player1 = gameState.getPlayer(battle.playerId); p1Id = battle.playerId; p2Id = 'wild';
        if (!player1) { return handleBattleEnd(battleId, null, battle.playerId, false, true); }
        p1Genmon = player1.team.find(g => g && g.uniqueId === battle.playerGenmonUniqueId);
        p2Genmon = battle.wildGenmon; action1 = battle.playerAction; action2 = null; battle.opponentAction = null;
    }
    if (!p1Genmon || !p2Genmon) {
        console.error(`Active Genmon missing in ${battle.type} battle ${battleId}. P1 found: ${!!p1Genmon}, P2/Wild found: ${!!p2Genmon}`);
        let winner = null, loser = null;
        if (battle.type === 'PvP') { winner = !p1Genmon ? p2Id : p1Id; loser = !p1Genmon ? p1Id : p2Id; }
        else { winner = !p2Genmon ? p1Id : null; loser = !p1Genmon ? p1Id : null; }
        return handleBattleEnd(battleId, winner, loser, false, true);
    }

    // --- Wild Action ---
    if (battle.type === 'PvE' && p2Genmon.currentHp > 0) { // Only determine action if wild is healthy
        let wildShouldAct = false;
        if (action1?.type === 'move' && p1Genmon.currentHp > 0) wildShouldAct = true;
        else if (action1?.type === 'swap') wildShouldAct = true;
        else if (action1?.type === 'catch' && !calculateCatchSuccessHelper(p2Genmon)) wildShouldAct = true;
        else if (action1?.type === 'flee' && Math.random() >= 0.6) wildShouldAct = true;

        if (wildShouldAct && p2Genmon.moves?.length > 0) {
            const wildMoveName = p2Genmon.moves[Math.floor(Math.random() * p2Genmon.moves.length)];
            action2 = { type: 'move', moveName: wildMoveName };
            battle.opponentAction = action2;
            console.log(`Battle ${battleId}: Wild ${p2Genmon.name} chose action: ${wildMoveName}`);
        }
    }

     // --- Action Order ---
     let firstActorId, secondActorId, firstAction, secondAction, firstGenmon, secondGenmon;
     const safeMoveData = getMoveData();
     const getActionPriority = (action) => (action?.type === 'swap' ? 6 : (safeMoveData[action?.moveName]?.priority || 0));
     const getGenmonSpeed = (genmon) => genmon?.stats?.spd || 0;
     const priority1 = getActionPriority(action1); const priority2 = getActionPriority(action2);
     const speed1 = getGenmonSpeed(p1Genmon); const speed2 = getGenmonSpeed(p2Genmon);
     if (priority1 > priority2) { firstActorId = p1Id; secondActorId = p2Id; }
     else if (priority2 > priority1) { firstActorId = p2Id; secondActorId = p1Id; }
     else { firstActorId = (speed1 >= speed2) ? p1Id : p2Id; secondActorId = (speed1 >= speed2) ? p2Id : p1Id; }
     if (firstActorId === p1Id) { firstAction = action1; firstGenmon = p1Genmon; secondAction = action2; secondGenmon = p2Genmon; }
     else { firstAction = action2; firstGenmon = p2Genmon; secondAction = action1; secondGenmon = p1Genmon; }
     console.log(`Battle ${battleId} Turn ${battle.turnNumber}: Order - ${firstActorId} (${firstAction?.type}, Prio ${getActionPriority(firstAction)}, Spd ${getGenmonSpeed(firstGenmon)}) then ${secondActorId} (${secondAction?.type}, Prio ${getActionPriority(secondAction)}, Spd ${getGenmonSpeed(secondGenmon)})`);

    // --- Execute Actions ---
    let battleShouldEnd = false;
    let winnerId = null; let loserId = null; let fled = false; let caught = false;
    let skipSecondAction = false; let firstActorFaintedTarget = false; let secondActorFaintedTarget = false;
    let faintedGenmonThisTurn = null;

    // Execute First
    let firstTargetGenmonRef = (firstActorId === p1Id) ? secondGenmon : firstGenmon;
    let firstTargetId = secondActorId;
    const action1Result = executeAction(firstActorId, firstAction, firstGenmon, firstTargetGenmonRef, firstTargetId, battle, turnUpdates);
    turnLog.push(...action1Result.log);
    if (action1Result.actorSwappedOut) { if (firstActorId === p1Id) { p1Genmon = action1Result.actorSwappedOut; firstGenmon = p1Genmon; } else { p2Genmon = action1Result.actorSwappedOut; firstGenmon = p2Genmon; } }
    if (action1Result.result.endedBattle) { battleShouldEnd = true; skipSecondAction = true; fled = action1Result.result.fled; caught = action1Result.result.caught; if (fled) { winnerId = null; loserId = firstActorId; } if (caught) { winnerId = firstActorId; loserId = 'wild'; } }
    if (action1Result.targetFainted) {
        firstActorFaintedTarget = true; faintedGenmonThisTurn = firstTargetGenmonRef;
        // Check end condition *immediately* after faint
        if (checkForBattleEndCondition(battleId, firstActorId, firstTargetId)) {
            console.log(`[DEBUG] Faint detected by ${firstActorId} on ${firstTargetId}. End condition met. Setting battleShouldEnd = true.`);
            battleShouldEnd = true; skipSecondAction = true; // Ensure second action is skipped
            if (!winnerId && !loserId) { winnerId = firstActorId; loserId = firstTargetId; }
        } else {
             console.log(`[DEBUG] Faint detected by ${firstActorId} on ${firstTargetId}. End condition NOT met.`);
        }
    }

    // Execute Second
    if (!skipSecondAction && secondAction) {
        let secondTargetGenmonRef = (secondActorId === p1Id) ? p2Genmon : p1Genmon;
        let secondTargetId = firstActorId;
        const secondActorCurrentGenmon = (secondActorId === p1Id) ? p1Genmon : p2Genmon;
        // Check if second actor itself is healthy
        if (secondActorCurrentGenmon?.currentHp > 0) {
            // Check if second actor's target is healthy
            if (secondTargetGenmonRef?.currentHp > 0) {
                const action2Result = executeAction(secondActorId, secondAction, secondActorCurrentGenmon, secondTargetGenmonRef, secondTargetId, battle, turnUpdates);
                turnLog.push(...action2Result.log);
                if (action2Result.actorSwappedOut) { if (secondActorId === p1Id) { p1Genmon = action2Result.actorSwappedOut; } else { p2Genmon = action2Result.actorSwappedOut; } }
                if (action2Result.result.endedBattle) { battleShouldEnd = true; fled = action2Result.result.fled; caught = action2Result.result.caught; if (fled && !loserId) { winnerId = null; loserId = secondActorId; } if (caught && !winnerId) { winnerId = secondActorId; loserId = 'wild'; } }
                if (action2Result.targetFainted) {
                    secondActorFaintedTarget = true; faintedGenmonThisTurn = secondTargetGenmonRef;
                     // Check end condition *immediately* after faint
                    if (checkForBattleEndCondition(battleId, secondActorId, secondTargetId)) {
                         console.log(`[DEBUG] Faint detected by ${secondActorId} on ${secondTargetId}. End condition met. Setting battleShouldEnd = true.`);
                         battleShouldEnd = true; // Set end flag
                         if (!winnerId && !loserId) { winnerId = secondActorId; loserId = secondTargetId; }
                    } else {
                         console.log(`[DEBUG] Faint detected by ${secondActorId} on ${secondTargetId}. End condition NOT met.`);
                    }
                }
            } else { turnLog.push(`${secondActorCurrentGenmon.name} targeted the already fainted ${secondTargetGenmonRef?.name || secondTargetId}!`); }
        } else { /* second actor already fainted */ }
    }

    // --- Post-Turn Updates ---
    battle.log.push(...turnLog);
    turnUpdates.logUpdate = turnLog;
    const updateMessage = { type: 'BATTLE_UPDATE', payload: turnUpdates };
    const updateString = JSON.stringify(updateMessage);
    const player1Ws = player1?.ws; const player2Ws = (battle.type === 'PvP') ? player2?.ws : null;
    if (turnUpdates.logUpdate.length > 0 || turnUpdates.p1GenmonUpdate || turnUpdates.p2GenmonUpdate) {
        console.log(`Battle ${battleId} Turn ${battle.turnNumber} Sending Updates:`, turnUpdates);
        if (player1Ws?.readyState === WebSocket.OPEN) player1Ws.send(updateString);
        if (player2Ws?.readyState === WebSocket.OPEN) player2Ws.send(updateString);
    } else {
         console.log(`Battle ${battleId} Turn ${battle.turnNumber}: No updates to send.`);
    }
    console.log(`Battle ${battleId} Turn ${battle.turnNumber} End Log:`, turnLog.join(' | ')); // 

    // --- End or Next Turn ---
    console.log(`[DEBUG] End of Turn ${battle.turnNumber}. Final check: battleShouldEnd = ${battleShouldEnd}`);

    if (battleShouldEnd) {
        console.log(`[DEBUG] Proceeding to handleBattleEnd for ${battleId}. Winner: ${winnerId}, Loser: ${loserId}`);
        // Determine winner/loser if still ambiguous (e.g., double KO)
        if (winnerId === null && loserId === null) { // Check strictly null, not 'wild'
            console.log(`[DEBUG] Winner/Loser ambiguous, determining from remaining Genmon.`);
            const p1CanContinue = player1?.team.some(g => g && g.currentHp > 0);
            const p2CanContinue = battle.type === 'PvP'
                ? player2?.team.some(g => g && g.currentHp > 0)
                : false; // Wild cannot continue if fainted
            if (!p1CanContinue && p2CanContinue) { loserId = p1Id; winnerId = p2Id; }
            else if (p1CanContinue && !p2CanContinue && battle.type === 'PvP') { loserId = p2Id; winnerId = p1Id; }
            else if (!p1CanContinue && !p2CanContinue) { // Draw or mutual loss
                loserId = p1Id; // Assign both as losers? Or handle draw state?
                winnerId = (battle.type === 'PvP') ? p2Id : null; // Assign P2 as winner in PvP draw? Needs rule definition.
                 console.log(`[DEBUG] Draw condition detected. Assigning Winner: ${winnerId}, Loser: ${loserId}`);
            } else {
                 // This case should ideally not be reached if battleShouldEnd is true
                 console.warn(`[DEBUG] Ambiguous winner/loser state despite battleShouldEnd being true.`);
                 // Default to player loss in PvE?
                 if(battle.type === 'PvE') { loserId = p1Id; winnerId = null; }
            }
        }
        // Adjust 'wild' IDs to null for handleBattleEnd
        const finalWinnerId = (winnerId === 'wild') ? null : winnerId;
        const finalLoserId = (loserId === 'wild') ? null : loserId;
        // --- CRITICAL: Call handleBattleEnd ---
        handleBattleEnd(battleId, finalWinnerId, finalLoserId, fled, false, caught, faintedGenmonThisTurn);
        // --- CRITICAL: Return here to prevent executing the 'else' block ---
        return;
    }
    // else { // No 'else' needed, if battleShouldEnd is false, execution continues here

        console.log(`[DEBUG] Proceeding to next turn/switch logic for ${battleId}.`);
        // Mark for Switch
        let p1NeedsSwitch = false; let p2NeedsSwitch = false;
        if (firstActorFaintedTarget && firstTargetId === p1Id) p1NeedsSwitch = true;
        if (firstActorFaintedTarget && firstTargetId === p2Id) p2NeedsSwitch = true;
        if (secondActorFaintedTarget && secondTargetId === p1Id) p1NeedsSwitch = true;
        if (secondActorFaintedTarget && secondTargetId === p2Id) p2NeedsSwitch = true;
        if (p1NeedsSwitch) markPlayerForSwitch(battleId, p1Id);
        if (p2NeedsSwitch && battle.type === 'PvP') markPlayerForSwitch(battleId, p2Id);

        // Next Turn/Switch Logic
        battle.p1Action = null; battle.p2Action = null; battle.playerAction = null; battle.opponentAction = null;
        battle.actionsReceived = 0; battle.turnNumber++; battle.waitingForAction = null;
        const p1MustSwitch = battle.p1MustSwitch; const p2MustSwitch = battle.p2MustSwitch;
        const currentP1 = gameState.getPlayer(p1Id);
        const currentP2 = battle.type === 'PvP' ? gameState.getPlayer(p2Id) : null;
        if (p1MustSwitch && currentP1 && !currentP1.team.some(g => g && g.currentHp > 0)) { return handleBattleEnd(battleId, battle.type === 'PvP' ? p2Id : null, p1Id, false, true, false, p1Genmon); }
        if (p2MustSwitch && currentP2 && !currentP2.team.some(g => g && g.currentHp > 0)) { return handleBattleEnd(battleId, p1Id, p2Id, false, true, false, p2Genmon); }

        // Determine Next Prompt
        let nextPlayerToPrompt = null; let promptType = 'action';
        if (p1MustSwitch || p2MustSwitch) {
            promptType = 'switch';
            const speed1 = getGenmonSpeed(p1Genmon); const speed2 = getGenmonSpeed(p2Genmon);
            if (p1MustSwitch && p2MustSwitch) { nextPlayerToPrompt = (speed1 >= speed2) ? p1Id : p2Id; }
            else if (p1MustSwitch) { nextPlayerToPrompt = p1Id; }
            else { nextPlayerToPrompt = p2Id; }
        } else {
            promptType = 'action';
            const currentSpeed1 = getGenmonSpeed(p1Genmon); const currentSpeed2 = getGenmonSpeed(p2Genmon);
            if (battle.type === 'PvP') { nextPlayerToPrompt = (currentSpeed1 >= currentSpeed2) ? p1Id : p2Id; console.log(`Battle ${battleId} Next Turn Order: ${nextPlayerToPrompt} (P1 Spd: ${currentSpeed1}, P2 Spd: ${currentSpeed2})`); }
            else { nextPlayerToPrompt = p1Id; }
        }

        // Send Prompt
        const playerToPrompt = gameState.getPlayer(nextPlayerToPrompt);
        if (playerToPrompt?.ws?.readyState === WebSocket.OPEN) {
            const actions = require('./actions'); // Deferred require
            if (actions && typeof actions.requestPlayerAction === 'function') {
                if (promptType === 'switch') {
                    console.log(`Battle ${battleId}: Requesting switch from ${nextPlayerToPrompt}.`);
                    playerToPrompt.ws.send(JSON.stringify({ type: 'REQUEST_SWITCH', payload: { battleId: battleId, reason: "Your Genmon fainted!"} }));
                    battle.waitingForAction = nextPlayerToPrompt;
                    if (battle.type === 'PvP') { /* Inform opponent */ }
                } else {
                    console.log(`Battle ${battleId}: Requesting action from ${nextPlayerToPrompt}.`);
                    actions.requestPlayerAction(nextPlayerToPrompt, battleId);
                }
            } else {
                console.error(`Critical Error: Could not load or find actions.requestPlayerAction for battle ${battleId}`);
                handleBattleEnd(battleId, battle.type === 'PvP' ? (nextPlayerToPrompt === p1Id ? p2Id : p1Id) : null, nextPlayerToPrompt, false, true, false, null);
            }
        } else {
            console.error(`Cannot prompt ${nextPlayerToPrompt} for ${promptType} in battle ${battleId}, WS unavailable.`);
            const winner = battle.type === 'PvP' ? (nextPlayerToPrompt === p1Id ? p2Id : p1Id) : null; const loser = nextPlayerToPrompt;
            const faintedGen = (loser === p1Id) ? p1Genmon : p2Genmon;
            handleBattleEnd(battleId, winner, loser, false, true, false, faintedGen);
        }
    // } // End of original ELSE block - removed structure
}

module.exports = {
    processBattleTurn,
};