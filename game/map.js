// FILE: ./game/map.js
const gameState = require('./gameState');
const { mapData, MAP_WIDTH, MAP_HEIGHT, TILE_OBSTACLE, TILE_GRASS, WILD_ENCOUNTER_CHANCE } = require('./constants');
const { broadcast, sendInfo } = require('./utils');
const { getPublicPlayerData } = require('./player');
const { startWildBattle } = require('./battle'); // Import from the battle index file

function handlePlayerMove(playerId, direction) {
    const player = gameState.getPlayer(playerId);
    if (!player || player.inBattle) return;
    if (!direction) { // Prevent moving without direction
        console.warn(`Player ${playerId} attempted move with invalid direction: ${direction}`);
        return;
    }

    let { x, y } = player;
    let targetX = x, targetY = y;

    switch (direction) {
        case 'up':    targetY--; break;
        case 'down':  targetY++; break;
        case 'left':  targetX--; break;
        case 'right': targetX++; break;
        default: return; // Invalid direction
    }

    // Update direction regardless of successful move
    const newDirection = direction;
    let positionChanged = false;
    let moveBlocked = false; // Track if move was blocked

    // Check map boundaries
    if (targetX < 0 || targetX >= MAP_WIDTH || targetY < 0 || targetY >= MAP_HEIGHT) {
        moveBlocked = true; // Hit boundary
    } else {
        // Check tile type (collision)
        const targetTile = mapData[targetY]?.[targetX]; // Safe access
        if (targetTile === undefined) { // Invalid map coordinates somehow
            moveBlocked = true;
            console.error(`Invalid target coordinates after boundary check: (${targetX}, ${targetY})`);
        } else if (targetTile === TILE_OBSTACLE) {
             moveBlocked = true;
             // Only send info if the obstacle is different from the current tile (avoids spamming against walls)
             // if (mapData[y]?.[x] !== TILE_OBSTACLE) {
             //     sendInfo(player.ws, "Cannot move there!");
             // }
        } else {
             // Check for other players (basic collision)
             let collision = false;
             const allPlayers = gameState.getAllPlayers();
             for (const pId in allPlayers) {
                if (pId !== playerId) {
                    const otherPlayer = allPlayers[pId];
                    if (otherPlayer.x === targetX && otherPlayer.y === targetY) {
                        // Allow moving *into* a space if the other player is in battle? Maybe not.
                        // if (!otherPlayer.inBattle) {
                            moveBlocked = true;
                            // sendInfo(player.ws, "Another player is there!");
                            collision = true; // Use collision flag if needed later
                            break;
                        // }
                    }
                }
            }

             if (!moveBlocked) {
                 // Move successful
                 positionChanged = true;
                 player.x = targetX;
                 player.y = targetY;
             }
        }
    }

    // Update player state in gameState (position only if changed, direction always)
    gameState.updatePlayer(playerId, {
        x: player.x, // Sends potentially updated x
        y: player.y, // Sends potentially updated y
        direction: newDirection
    });

    // Broadcast the update (includes new position and direction)
    // Send even if blocked, so direction change is reflected
    const publicData = getPublicPlayerData(playerId);
    if (publicData && player.ws?.server) {
         broadcast(player.ws.server, gameState.getAllPlayers(), {
             type: 'PLAYER_UPDATE',
             payload: { player: publicData }
         });
    }


    // Check for wild encounter if move was successful onto grass
    if (positionChanged && mapData[player.y]?.[player.x] === TILE_GRASS) {
        if (Math.random() < WILD_ENCOUNTER_CHANCE) {
            // Ensure player has fightable Genmon before starting
            const canFight = player.team && player.team.some(g => g && g.currentHp > 0);
            if (canFight) {
                console.log(`Player ${playerId} triggered a wild encounter at (${player.x}, ${player.y})!`);
                startWildBattle(playerId); // Call battle logic from imported index
            } else {
                // Don't start battle if no healthy genmon, maybe inform player
                // sendInfo(player.ws, "You have no Genmon ready to fight!");
                 console.log(`Player ${playerId} encountered wild patch but has no healthy Genmon.`);
            }
        }
    }
}

module.exports = {
    handlePlayerMove,
};