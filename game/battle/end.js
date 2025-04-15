const WebSocket = require('ws');
const gameState = require('../gameState');
const { sendInfo, broadcast } = require('../utils');
const { getPrivatePlayerData } = require('../player');
const { DUEL_WIN_MONEY } = require('../constants');
const { calculateXpYield, processLevelUp } = require('../leveling');

// --- Battle End ---
function handleBattleEnd(battleId, winnerId, loserId, fled = false, forfeited = false, caught = false, defeatedGenmon = null) {
    const battle = gameState.getBattle(battleId);
    if (!battle || battle.ended) {
         console.log(`Attempted to end already ended or non-existent battle: ${battleId}`);
         return;
    }
    battle.ended = true; // Mark ended immediately to prevent race conditions

    console.log(`Ending battle ${battleId}. Winner: ${winnerId}, Loser: ${loserId}, Fled: ${fled}, Forfeit: ${forfeited}, Caught: ${caught}`);

    let finalMessage = "";
    let winnerName = winnerId || "???";
    let loserName = loserId || "???";
    const wildName = battle.wildGenmon?.name || "Wild Genmon";
    const wildLevel = battle.wildGenmon?.level || "?";

    const battleEndPayload = {
        battleId: battleId,
        battleType: battle.type,
        winnerId: winnerId,
        loserId: loserId,
        forfeited: forfeited,
        caught: caught,
        fled: fled,
        finalLog: [],
        rewards: {} // Store rewards per player { playerId: { xpGained: {...}, moneyGained: X, levelUps: [...] } }
    };

    // --- Calculate Rewards if there's a Winner ---
    if (winnerId && !fled && !caught /*&& !forfeited - allow rewards on forfeit? Yes */) {
         const winner = gameState.getPlayer(winnerId); // Get current winner state
         const loser = loserId ? gameState.getPlayer(loserId) : null; // Get loser state if applicable

         if (winner) {
             let actualDefeatedGenmon = defeatedGenmon; // Use the one passed if available

             // Determine defeated Genmon for XP if not explicitly passed
             if (!actualDefeatedGenmon) {
                  if (battle.type === 'PvE' && loserId === battle.playerId) {
                       // If player lost PvE, the wild defeated them
                       actualDefeatedGenmon = battle.wildGenmon;
                  } else if (battle.type === 'PvP' && loser) {
                       // Try to find the last active genmon of the loser
                       const loserActiveUniqueId = (loserId === battle.player1Id) ? battle.p1GenmonUniqueId : battle.p2GenmonUniqueId;
                       actualDefeatedGenmon = loser.team.find(g => g && g.uniqueId === loserActiveUniqueId);
                       // Fallback: Find any fainted genmon on loser's team if active one isn't marked fainted somehow
                       if (!actualDefeatedGenmon || actualDefeatedGenmon.currentHp > 0) {
                            actualDefeatedGenmon = loser.team.find(g => g && g.currentHp <= 0);
                       }
                   } else if (battle.type === 'PvE' && winnerId === battle.playerId) {
                        // If player won PvE, they defeated the wild genmon
                        actualDefeatedGenmon = battle.wildGenmon;
                   }
             }

             // --- XP Calculation ---
             let xpGainedDetails = {}; // { genmonUniqueId: amount, ... }
             let levelUpDetails = []; // Array of level-up result objects
             if (actualDefeatedGenmon && battle.participants && battle.participants[winnerId]) {
                  const xpAmount = calculateXpYield(actualDefeatedGenmon);
                  const participantSet = battle.participants[winnerId];
                  const numParticipants = participantSet ? participantSet.size : 0;
                  const xpPerParticipant = numParticipants > 0 ? Math.max(1, Math.floor(xpAmount / numParticipants)) : 0;

                  console.log(`Battle ${battleId}: Defeated ${actualDefeatedGenmon.name} (Lvl ${actualDefeatedGenmon.level}), XP Yield: ${xpAmount}. Participants: ${numParticipants}, XP per: ${xpPerParticipant}`);

                  let updatedTeam = [...winner.team]; // Create a mutable copy
                  let teamChanged = false;

                  participantSet.forEach(participantUniqueId => {
                       const genmonIndex = updatedTeam.findIndex(g => g && g.uniqueId === participantUniqueId);
                       if (genmonIndex !== -1 && updatedTeam[genmonIndex].currentHp > 0) { // Only award XP to non-fainted participants
                            const genmon = updatedTeam[genmonIndex];
                            genmon.xp = (genmon.xp || 0) + xpPerParticipant;
                            xpGainedDetails[genmon.uniqueId] = xpPerParticipant;
                            console.log(`Awarding ${xpPerParticipant} XP to ${genmon.name} (ID: ${genmon.uniqueId}). New XP: ${genmon.xp}/${genmon.xpToNextLevel}`);

                            // Check for level up (processLevelUp modifies the genmon object directly)
                            const levelUpResult = processLevelUp(genmon);
                            if (levelUpResult) {
                                levelUpDetails.push(levelUpResult);
                                // genmon object in updatedTeam is already modified by processLevelUp
                            }
                            teamChanged = true;
                       } else {
                            console.log(`Skipping XP for ${participantUniqueId} (fainted or not found).`)
                       }
                  });

                  // Update player state with the modified team if changes occurred
                  if (teamChanged) {
                       gameState.updatePlayer(winnerId, { team: updatedTeam });
                       // Update local reference too if it exists
                       if (winner) winner.team = updatedTeam;
                  }
             } else {
                  console.log(`Battle ${battleId}: Could not calculate XP for winner ${winnerId}. Defeated Genmon: ${!!actualDefeatedGenmon}, Participants: ${battle.participants ? !!battle.participants[winnerId] : 'N/A'}`);
             }

             // --- Money Calculation (PvP only) ---
             let moneyGained = 0;
             if (battle.type === 'PvP') {
                  moneyGained = DUEL_WIN_MONEY;
                  winner.money = (winner.money || 0) + moneyGained;
                  gameState.updatePlayer(winnerId, { money: winner.money });
                  console.log(`Awarding ${moneyGained} money to ${winnerId}. New total: ${winner.money}`);
             }

             // Store rewards in payload
             battleEndPayload.rewards[winnerId] = {
                  xpGained: xpGainedDetails,
                  moneyGained: moneyGained,
                  levelUps: levelUpDetails
             };
         } else {
              console.log(`Battle ${battleId}: Winner ${winnerId} not found, cannot assign rewards.`);
         }
    }


    // --- Determine Final Message ---
     // Note: winnerId/loserId here are the potentially null values before 'wild' adjustment
     if (battle.type === 'PvP') {
        winnerName = winnerId || "Winner"; // Handle potential null winner on forfeit
        loserName = loserId || "Loser"; // Handle potential null loser on forfeit
        if (winnerId && loserId && !forfeited) { finalMessage = `${winnerName} defeated ${loserName}!`; }
        else if (forfeited && winnerId && loserId) { finalMessage = `${loserName} forfeited or disconnected! ${winnerName} wins!`; } // Loser explicit
        else if (forfeited && winnerId && !loserId) { loserId = (winnerId === battle.player1Id ? battle.player2Id : battle.player1Id); loserName = loserId; finalMessage = `${loserName} forfeited or disconnected! ${winnerName} wins!`; } // Winner known, loser inferred
        else if (forfeited && loserId && !winnerId) { winnerId = (loserId === battle.player1Id ? battle.player2Id : battle.player1Id); winnerName = winnerId; finalMessage = `${loserName} lost due to forfeit or disconnect! ${winnerName} wins!`;} // Loser known, winner inferred
        else { finalMessage = "The duel ended unexpectedly."; } // Both disconnected?
    } else { // PvE
        const player = gameState.getPlayer(battle.playerId);
        if (caught) { finalMessage = `Gotcha! ${wildName} (Lvl ${wildLevel}) was caught!`; winnerId = battle.playerId; loserId = null; }
        else if (winnerId === battle.playerId) { finalMessage = `You defeated the wild ${wildName} (Lvl ${wildLevel})!`; loserId = null; }
        else { // Player lost, fled, or disconnected
            loserId = battle.playerId; winnerId = null; // Wild effectively wins
            if (fled) { finalMessage = `Got away safely from ${wildName} (Lvl ${wildLevel}).`; }
            else if (forfeited) { finalMessage = `Disconnected from battle with ${wildName} (Lvl ${wildLevel}).`; }
            else { finalMessage = `You were defeated by the wild ${wildName} (Lvl ${wildLevel})!`; if (player?.ws) sendInfo(player.ws, "You blacked out!"); }
        }
    }

    // Add reward messages to log (if winner exists and rewards calculated)
    const winnerPlayerId = battleEndPayload.winnerId; // Use the final winner ID
    if (winnerPlayerId && battleEndPayload.rewards[winnerPlayerId]) {
         const rewards = battleEndPayload.rewards[winnerPlayerId];
         const winner = gameState.getPlayer(winnerPlayerId); // Get winner ref again
         if (winner) { // Check winner still exists
            let xpMsg = "";
            for (const uid in rewards.xpGained) {
                const genmon = winner.team.find(g => g && g.uniqueId === uid);
                if(genmon) xpMsg += `${genmon.name} earned ${rewards.xpGained[uid]} XP. `;
            }
            if (xpMsg) battle.log.push(xpMsg.trim());

            if (rewards.moneyGained > 0) { battle.log.push(`${winnerPlayerId} earned $${rewards.moneyGained}!`); }

            rewards.levelUps.forEach(lvlUp => {
                 const genmon = winner.team.find(g => g && g.uniqueId === lvlUp.genmonUniqueId);
                 if(genmon) battle.log.push(`${genmon.name} grew to Level ${lvlUp.newLevel}!`);
                 // Could add stat gain details here too
            });
         }
    }
    // Add final outcome message if not already present
    if (finalMessage && !battle.log.some(msg => msg.includes(finalMessage.substring(0, 20)))) {
         battle.log.push(finalMessage);
    } else if (!finalMessage) {
         battle.log.push("Battle ended.");
    }

    battleEndPayload.finalLog = battle.log; // Add updated log to payload


    // --- Send Updates and Clean Up ---
    const battleEndString = JSON.stringify({ type: 'BATTLE_END', payload: battleEndPayload });
    const playerIdsInvolved = battle.type === 'PvP' ? [battle.player1Id, battle.player2Id] : [battle.playerId];
    let wss = null;

    playerIdsInvolved.forEach(pId => {
        const player = gameState.getPlayer(pId);
        if (player) {
            // Update player state (reset battle status) BEFORE sending final player data
            const updates = { inBattle: false, currentBattleId: null };
             // Include potentially updated money/team from rewards
             if (player.money !== undefined) updates.money = player.money;
             if (player.team !== undefined) updates.team = player.team; // Ensure team reflects level ups etc.
            gameState.updatePlayer(pId, updates);

            // Update local reference if needed (often redundant now)
            player.inBattle = false;
            player.currentBattleId = null;

            if (player.ws && player.ws.readyState === WebSocket.OPEN) {
                 if (!wss) wss = player.ws.server; // Grab wss reference
                 player.ws.send(battleEndString); // Send BATTLE_END first

                 // Send final player data state AFTER battle end message
                 // Schedule slightly later to allow client to process BATTLE_END
                 setTimeout(() => {
                      if (player.ws && player.ws.readyState === WebSocket.OPEN) {
                         const finalPlayerData = getPrivatePlayerData(pId);
                         if (finalPlayerData) {
                              player.ws.send(JSON.stringify({ type: 'PLAYER_DATA_UPDATE', payload: finalPlayerData }));
                         }
                      }
                 }, 100); // 100ms delay, adjust if needed

             }
        }
    });

    // Remove battle from active battles AFTER informing players
    gameState.removeBattle(battleId);

    // Notify others that these players are no longer in battle
    if (wss) {
        broadcast(wss, gameState.getAllPlayers(), { type: 'PLAYER_BATTLE_END', payload: { playerIds: playerIdsInvolved } }, null);
    } else {
        console.log(`Battle ${battleId} ended, but could not find WebSocket server instance to broadcast PLAYER_BATTLE_END.`);
    }

    console.log(`Battle ${battleId} officially ended and removed. Final message: ${finalMessage}`);
}


// --- Handle Player Disconnect during Battle ---
function handlePlayerDisconnectBattle(playerId) {
     // Player object might already be removed, so search battles directly
     let battleId = null;
     let battle = null;
     const allBattles = gameState.getAllBattles();

     for (const id in allBattles) {
         const b = allBattles[id];
         if (!b.ended) { // Only consider active battles
             if ((b.type === 'PvP' && (b.player1Id === playerId || b.player2Id === playerId)) ||
                 (b.type === 'PvE' && b.playerId === playerId))
             {
                 battle = b;
                 battleId = id;
                 break;
             }
         }
     }

     if (!battle) {
         console.log(`Disconnect: Active battle for player ${playerId} not found.`);
         return;
     }
     if (battle.ended) { // Check again after finding it, in case of race condition
          console.log(`Disconnect: Battle ${battleId} for player ${playerId} was already ended.`);
          return;
     }

     console.log(`Handling disconnect for player ${playerId} during battle ${battleId}`);

      // Find the Genmon the disconnecting player *might* have had active
      // This is difficult if the player object is already gone. Use battle state.
      let disconnectedPlayerGenmon = null; // We can't reliably get the Genmon *object* for XP if player state is gone
      // We primarily need the *loser* ID for the battle end logic.

     if (battle.type === 'PvP') {
         const opponentId = battle.player1Id === playerId ? battle.player2Id : battle.player1Id;
         // Opponent wins, disconnected player loses. Pass null for defeated Genmon as we can't guarantee its state/data.
         handleBattleEnd(battleId, opponentId, playerId, false, true, false, null);
     } else { // PvE
         // Player disconnected, they lose. Pass null for defeated Genmon.
         handleBattleEnd(battleId, null, playerId, false, true, false, null);
     }
}


module.exports = {
    handleBattleEnd,
    handlePlayerDisconnectBattle,
};