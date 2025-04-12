const gameState = require('./gameState');
const { mapData, MAP_WIDTH, MAP_HEIGHT, TILE_OBSTACLE, TILE_GRASS, WILD_ENCOUNTER_CHANCE } = require('./constants');
const { broadcast, sendInfo } = require('./utils');
const { getPublicPlayerData } = require('./player');
const { startWildBattle } = require('./battle'); // Assuming startWildBattle is exported from battle.js

function handlePlayerMove(playerId, direction) {
    const player = gameState.getPlayer(playerId);
    if (!player || player.inBattle) return;

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

    // Check map boundaries
    if (targetX < 0 || targetX >= MAP_WIDTH || targetY < 0 || targetY >= MAP_HEIGHT) {
    } else {
        // Check tile type (collision)
        const targetTile = mapData[targetY][targetX];
        if (targetTile === TILE_OBSTACLE) {
             sendInfo(player.ws, "Cannot move there!");
        } else {
             // Check for other players (basic collision)
             let collision = false;
             const allPlayers = gameState.getAllPlayers();
             for (const pId in allPlayers) {
                if (pId !== playerId && allPlayers[pId].x === targetX && allPlayers[pId].y === targetY) {
                    sendInfo(player.ws, "Another player is there!");
                    collision = true;
                    break;
                }
            }

             if (!collision) {
                 // Move successful
                 positionChanged = true;
                 player.x = targetX;
                 player.y = targetY;
             }
        }
    }

    // Update player state in gameState
    gameState.updatePlayer(playerId, { x: player.x, y: player.y, direction: newDirection });

    // Broadcast the update (includes new position and direction)
    broadcast(player.ws.server, gameState.getAllPlayers(), {
        type: 'PLAYER_UPDATE',
        payload: { player: getPublicPlayerData(playerId) }
    });


    // Check for wild encounter if move was successful onto grass
    if (positionChanged && mapData[player.y][player.x] === TILE_GRASS) {
        if (Math.random() < WILD_ENCOUNTER_CHANCE) {
            // Ensure player has fightable Genmon before starting
            const canFight = player.team.some(g => g.currentHp > 0);
            if (canFight) {
                console.log(`Player ${playerId} triggered a wild encounter at (${player.x}, ${player.y})!`);
                startWildBattle(playerId); // Call battle logic
            } else {
                sendInfo(player.ws, "You have no Genmon ready to fight!");
            }
        }
    }
}

module.exports = {
    handlePlayerMove,
};