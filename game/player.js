const WebSocket = require('ws');
const gameState = require('./gameState');
const { sendInfo, broadcast } = require('./utils');
const { HEAL_AMOUNT, HEAL_INTERVAL, MAX_TEAM_SIZE } = require('./constants');

// Get simplified player data for broadcasting
function getPublicPlayerData(playerId = null) {
    const players = gameState.getAllPlayers();

    const getData = (p) => {
        if (!p) return null;
        // Ensure team exists and index is valid before accessing
        const activeGenmon = (p.team && p.team.length > 0 && p.activeGenmonIndex >= 0 && p.activeGenmonIndex < p.team.length)
                              ? p.team[p.activeGenmonIndex]
                              : null;

        // Determine sprite: Use active Genmon's sprite, fallback to default player
        const sprite = activeGenmon?.sprite || '/assets/player_variant1.png'; // Default sprite if no active genmon or no sprite defined
        // TODO: Add directional sprite logic here if assets become available
        // e.g., based on p.direction

        const genmonName = activeGenmon?.name || "---";
        const genmonLevel = activeGenmon?.level || "?"; // Add level

        return {
            id: p.id,
            x: p.x,
            y: p.y,
            direction: p.direction,
            sprite: sprite,
            inBattle: p.inBattle,
            genmonName: genmonName,
            genmonLevel: genmonLevel, // Include level
        };
    };

    if (playerId) {
        const p = players[playerId];
        return p ? getData(p) : null;
    } else {
        const publicData = {};
        for (const id in players) {
            const pData = getData(players[id]);
            if (pData) {
                publicData[id] = pData;
            }
        }
        return publicData;
    }
}

// Get detailed data for the player themselves
function getPrivatePlayerData(playerId) {
    const p = gameState.getPlayer(playerId);
    if (!p) return null;
    // Return a structured object matching the TEAM_UPDATE payload structure for consistency
    return {
        // Include player position etc if needed by TEAM_UPDATE consumer, otherwise just team info
        // id: p.id,
        // x: p.x,
        // y: p.y,
        // direction: p.direction,
        // inBattle: p.inBattle,
        // currentBattleId: p.currentBattleId,
        team: p.team, // Full team data (includes level, xp etc)
        activeGenmonIndex: p.activeGenmonIndex,
        money: p.money, // Include money
    };
}

// --- Team Management ---
function handleSwapGenmonTeam(playerId, teamIndex) {
    const player = gameState.getPlayer(playerId);
    if (!player) return;
    if (player.inBattle) return sendInfo(player.ws, "Cannot swap team members during battle.");
    if (teamIndex < 0 || teamIndex >= player.team.length) {
        return sendInfo(player.ws, "Invalid team index.");
    }
    if (player.team[teamIndex].currentHp <= 0) {
        return sendInfo(player.ws, "Cannot switch to a fainted Genmon outside of battle.");
    }
    if (player.activeGenmonIndex === teamIndex) {
        return sendInfo(player.ws, `${player.team[teamIndex].name} is already active.`);
    }

    gameState.updatePlayer(playerId, { activeGenmonIndex: teamIndex });
    const updatedPlayer = gameState.getPlayer(playerId); // Get updated player state

    sendInfo(updatedPlayer.ws, `Switched active Genmon to ${updatedPlayer.team[teamIndex].name}.`);
    // Send updated private data (team + active index + money)
    updatedPlayer.ws.send(JSON.stringify({ type: 'PLAYER_DATA_UPDATE', payload: getPrivatePlayerData(playerId) })); // Use a more general update type maybe?
    // Broadcast public data change (likely sprite change)
    broadcast(player.ws.server, gameState.getAllPlayers(), { type: 'PLAYER_UPDATE', payload: { player: getPublicPlayerData(playerId) } }, player.ws); // Exclude self
}

function handleReleaseGenmon(playerId, teamIndex) {
    const player = gameState.getPlayer(playerId);
     if (!player) return;
     if (player.inBattle) return sendInfo(player.ws, "Cannot release Genmon during battle.");
    if (player.team.length <= 1) {
        return sendInfo(player.ws, "Cannot release your last Genmon!");
    }
    if (teamIndex < 0 || teamIndex >= player.team.length) {
        return sendInfo(player.ws, "Invalid team index.");
    }

    const releasedGenmon = player.team[teamIndex]; // Get ref before modifying
    const newTeam = player.team.filter((_, index) => index !== teamIndex); // Create new array excluding released one

    let newActiveIndex = player.activeGenmonIndex;

    // If released was active, set first healthy as active (or 0 if all fainted)
    if (player.activeGenmonIndex === teamIndex) {
        newActiveIndex = newTeam.findIndex(g => g.currentHp > 0);
        if (newActiveIndex === -1) newActiveIndex = 0; // Default to 0 if no healthy left
    }
    // If released was before active, decrement active index
    else if (player.activeGenmonIndex > teamIndex) {
        newActiveIndex--;
    }

    gameState.updatePlayer(playerId, { team: newTeam, activeGenmonIndex: newActiveIndex });
    const updatedPlayer = gameState.getPlayer(playerId); // Get updated state

    sendInfo(updatedPlayer.ws, `${releasedGenmon.name} was released.`);
    // Send updated private data
    updatedPlayer.ws.send(JSON.stringify({ type: 'PLAYER_DATA_UPDATE', payload: getPrivatePlayerData(playerId) }));
    // Broadcast public data change (potentially active genmon/sprite change)
    broadcast(player.ws.server, gameState.getAllPlayers(), { type: 'PLAYER_UPDATE', payload: { player: getPublicPlayerData(playerId) } }, player.ws); // Exclude self
}

// --- HP Regeneration ---
function regenerateHp() {
    let updatedPlayers = {}; // Track players whose HP changed
    const players = gameState.getAllPlayers();

    for (const playerId in players) {
        const player = players[playerId];
        // Regenerate HP only if OUTSIDE of battle and team exists
        if (!player.inBattle && player.team && player.team.length > 0) {
            let changed = false;
            // Use map to create a new team array with updated HP
            const newTeam = player.team.map(genmon => {
                 // Check if HP not full
                 if (genmon.currentHp < genmon.stats.hp) { // Keep this like that
                    // Create a copy to modify
                    const updatedGenmon = {...genmon};
                    updatedGenmon.currentHp = Math.min(updatedGenmon.stats.hp, updatedGenmon.currentHp + HEAL_AMOUNT);
                    changed = true;
                    return updatedGenmon;
                 }
                 // Return original object if no change needed
                 return genmon;
            });

            if (changed) {
                // Update the player's team in the gameState only if changes occurred
                gameState.updatePlayer(playerId, { team: newTeam });
                updatedPlayers[playerId] = true; // Mark player for update notification
            }
        }
    }

    // Send updates only to players whose HP regenerated
    for (const playerId in updatedPlayers) {
        const player = gameState.getPlayer(playerId); // Get potentially updated player data
        if (player && player.ws && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(JSON.stringify({
                type: 'PLAYER_DATA_UPDATE', // Use the general player data update message
                payload: getPrivatePlayerData(playerId) // Send updated team, active index, and money
            }));
        }
    }
}

// --- Periodic HP Regen Timer ---
setInterval(regenerateHp, HEAL_INTERVAL);


module.exports = {
    getPublicPlayerData,
    getPrivatePlayerData,
    handleSwapGenmonTeam,
    handleReleaseGenmon,
};