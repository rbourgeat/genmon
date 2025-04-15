// --- FILE: ./game/battle/state.js ---
const gameState = require('../gameState');

// Helper to check if a player losing their current Genmon ends the battle
function checkForBattleEndCondition(battleId, actorId, targetId) {
    const battle = gameState.getBattle(battleId);
    if (!battle || battle.ended) {
        console.log(`[DEBUG] checkForBattleEndCondition(${battleId}): Battle non-existent or already ended.`);
        return true; // Already ended or non-existent
    }

    let targetPlayer = null;
    let targetIsPlayer = false;
    let shouldEnd = false; // Variable to hold result

    // Identify if the target is a player and get their object
    if (battle.type === 'PvP') {
        if (targetId === battle.player1Id || targetId === battle.player2Id) {
            targetPlayer = gameState.getPlayer(targetId);
            targetIsPlayer = true;
        } else {
             // Should not happen in PvP if targetId is valid
             console.warn(`[DEBUG] Battle ${battleId}: PvP target is not player1 or player2: ${targetId}`);
        }
    } else { // PvE
        if (targetId === battle.playerId) {
            targetPlayer = gameState.getPlayer(targetId);
            targetIsPlayer = true;
        } else if (targetId === 'wild') {
            // If the wild Genmon (target) fainted, the player wins (battle ends)
            const wildFainted = !battle.wildGenmon || battle.wildGenmon.currentHp <= 0;
            console.log(`[DEBUG] Check PvE End: Wild target (${targetId}), HP=${battle.wildGenmon?.currentHp}, Fainted=${wildFainted}`);
            shouldEnd = wildFainted; // Assign result
        } else {
             // Should not happen in PvE if targetId is valid
             console.warn(`[DEBUG] Battle ${battleId}: PvE target is not player or wild: ${targetId}`);
        }
    }

    // If the target was a player, check their remaining team
    if (targetIsPlayer) {
        if (!targetPlayer) {
            console.log(`[DEBUG] Battle ${battleId}: Target player ${targetId} not found during end check (disconnected?). Setting shouldEnd = true.`);
            shouldEnd = true; // Target player doesn't exist - Battle should end
        } else {
            // Check if *any* genmon on the target player's team is healthy
            const hasMoreGenmon = targetPlayer.team && targetPlayer.team.some(g => g && g.currentHp > 0);
            // Battle ends if the target player has no more healthy Genmon
            console.log(`[DEBUG] Check Player End: Target ${targetId}, Has More Genmon=${hasMoreGenmon}. Setting shouldEnd = ${!hasMoreGenmon}`);
            shouldEnd = !hasMoreGenmon; // Assign result
        }
    } else if (targetId !== 'wild') {
         // Should not be reached in standard PvE/PvP if targetId is valid participant
         console.warn(`[DEBUG] Battle ${battleId}: checkForBattleEndCondition reached unexpected state with non-player, non-wild targetId: ${targetId}`);
         shouldEnd = false; // Default to battle continuing if logic is unclear
    }

    console.log(`[DEBUG] checkForBattleEndCondition(${battleId}, actor: ${actorId}, target: ${targetId}) returning: ${shouldEnd}`);
    return shouldEnd;
}


// Helper to mark a player as needing to switch
function markPlayerForSwitch(battleId, playerIdToSwitch) {
     const battle = gameState.getBattle(battleId);
     if (!battle || battle.ended || playerIdToSwitch === 'wild') return;

     const player = gameState.getPlayer(playerIdToSwitch);
     if (!player) {
          console.log(`Battle ${battleId}: Cannot mark player ${playerIdToSwitch} for switch, player not found.`);
          return; // Player might have disconnected right after fainting
     }
     const canSwitch = player.team && player.team.some(g => g && g.currentHp > 0);
     if (!canSwitch) {
          console.log(`Battle ${battleId}: ${playerIdToSwitch} fainted but has no more Genmon (Battle should have ended). Not marking for switch.`);
          // This might be the point where the battle should *definitely* end if not caught earlier
          // However, the end condition check should handle this.
          return; // Don't mark if they can't switch (battle should end instead)
      }

     let marked = false;
     if (battle.type === 'PvP') {
         if (playerIdToSwitch === battle.player1Id) { battle.p1MustSwitch = true; marked = true; }
         else if (playerIdToSwitch === battle.player2Id) { battle.p2MustSwitch = true; marked = true;}
     } else { // PvE
         if (playerIdToSwitch === battle.playerId) { battle.p1MustSwitch = true; marked = true; }
     }

     if (marked) {
           console.log(`Battle ${battleId}: Marked ${playerIdToSwitch} as needing to switch.`);
     }
}


module.exports = {
    checkForBattleEndCondition,
    markPlayerForSwitch,
};