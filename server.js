const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const {
    genmonData,
    moveData,
    calculateDamage,
    calculateCatchSuccess,
    createGenmonInstance,
    generateUniqueId // Import if needed, or keep internal
} = require('./data/genmonData'); // Updated import

const PORT = process.env.PORT || 3000;

// --- Simple HTTP Server --- (Keep as is)
const server = http.createServer((req, res) => {
    let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
    let extname = String(path.extname(filePath)).toLowerCase();
    let contentType = 'text/html';
    const mimeTypes = {
        '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
        '.png': 'image/png', '.jpg': 'image/jpg', // Add other necessary mime types
    };
    contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code == 'ENOENT') {
                 // Simple fallback for assets (adjust as needed)
                 // Check if request is for an asset first
                 if (req.url.startsWith('/assets/')) {
                     filePath = path.join(__dirname, 'public', req.url);
                 } else {
                     // Default fallback to index.html for SPA behavior maybe? or 404
                     filePath = path.join(__dirname, 'public', 'index.html'); // Fallback?
                 }
                 fs.readFile(filePath, (assetError, assetContent) => {
                     if (assetError) {
                         res.writeHead(404, { 'Content-Type': 'text/html' });
                         res.end('404 Not Found');
                     } else {
                         contentType = mimeTypes[String(path.extname(filePath)).toLowerCase()] || 'application/octet-stream';
                         res.writeHead(200, { 'Content-Type': contentType });
                         res.end(assetContent, 'utf-8');
                     }
                 });
            } else {
                res.writeHead(500);
                res.end('Sorry, check with the site admin for error: ' + error.code + ' ..\n');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});


// --- WebSocket Server ---
const wss = new WebSocket.Server({ server });

// --- Game State ---
let players = {}; // Store player data { id: { ws, x, y, direction, team: [genmonInstance...], activeGenmonIndex, inBattle, currentBattleId, ... } }

// Simplified Map Data (0: Path, 1: Grass, 2: Obstacle)
const TILE_PATH = 0;
const TILE_GRASS = 1;
const TILE_OBSTACLE = 2;
const mapData = [
    [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
    [2, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 2],
    [2, 0, 2, 0, 1, 2, 2, 1, 0, 2, 0, 2],
    [2, 0, 2, 0, 0, 0, 0, 0, 0, 2, 0, 2],
    [2, 1, 1, 0, 2, 0, 0, 2, 0, 1, 1, 2],
    [2, 1, 1, 0, 2, 0, 0, 2, 0, 1, 1, 2],
    [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2],
    [2, 0, 2, 1, 1, 2, 2, 1, 1, 2, 0, 2],
    [2, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 2],
    [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
];
const MAP_WIDTH = mapData[0].length;
const MAP_HEIGHT = mapData.length;
const WILD_ENCOUNTER_CHANCE = 0.15; // 15% chance per step on grass
const HEAL_INTERVAL = 10000; // Heal every 10 seconds
const HEAL_AMOUNT = 1; // Heal 1 HP per interval

let activeBattles = {}; // Stores state for ongoing battles { battleId: { type: 'PvP'/'PvE', player1Id, player2Id/wildGenmon, turn, log, ... } }


console.log(`WebSocket server started on port ${PORT}`);

// --- HP Regeneration Timer ---
setInterval(regenerateHp, HEAL_INTERVAL);

wss.on('connection', (ws) => {
    const playerId = generateUniqueId();
    console.log(`Client connected: ${playerId}`);

    // Find a valid starting position (not obstacle)
    let startX, startY;
    do {
        startX = Math.floor(Math.random() * MAP_WIDTH);
        startY = Math.floor(Math.random() * MAP_HEIGHT);
    } while (mapData[startY][startX] === TILE_OBSTACLE);

    // Assign starting Genmon team
    const startingGenmonId = Object.keys(genmonData)[Math.floor(Math.random() * Object.keys(genmonData).length)];
    const startingGenmonInstance = createGenmonInstance(startingGenmonId);

    players[playerId] = {
        ws: ws,
        id: playerId,
        x: startX,
        y: startY,
        direction: 'down', // Default direction
        team: startingGenmonInstance ? [startingGenmonInstance] : [], // Start with one Genmon
        activeGenmonIndex: 0,
        inBattle: false,
        currentBattleId: null
    };

    // Send initial state to the new player
    ws.send(JSON.stringify({
        type: 'INIT',
        payload: {
            playerId: playerId,
            players: getPublicPlayerData(), // Send simplified data of others
            mapData: mapData,
            yourPlayer: getPrivatePlayerData(playerId) // Send detailed own data
        }
    }));

    // Broadcast new player connection to others
    broadcast({
        type: 'PLAYER_JOIN',
        payload: { player: getPublicPlayerData(playerId) }
    }, ws); // Exclude sender

    // Handle messages
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            // console.log(`Received from ${playerId}:`, data); // Debugging
            handleClientMessage(playerId, data);
        } catch (error) {
            console.error(`Failed to parse message or handle request from ${playerId}:`, error);
            // Attempt to send an error back to the client if possible
            sendInfo(ws, `Server error processing your request: ${error.message}`);
            // Optionally disconnect the client if the error is severe
             // handleDisconnect(playerId);
        }
    });

    // Handle disconnection
    ws.on('close', () => handleDisconnect(playerId));
    ws.on('error', (error) => {
         console.error(`WebSocket error for ${playerId}:`, error);
         handleDisconnect(playerId);
     });
});

// --- Message Handler ---
function handleClientMessage(playerId, data) {
    const player = players[playerId];
    if (!player) return;

    // Centralized check for actions allowed during battle
    const battleActions = ['SELECT_MOVE', 'ATTEMPT_CATCH', 'SWAP_GENMON_BATTLE', 'FLEE_BATTLE'];
    // Actions allowed outside battle
    const nonBattleActions = ['MOVE', 'INITIATE_DUEL', 'RESPOND_DUEL', 'SWAP_GENMON_TEAM', 'RELEASE_GENMON'];

    if (player.inBattle && !battleActions.includes(data.type)) {
         sendInfo(player.ws, `Action ${data.type} not allowed during battle.`);
         console.log(`Player ${playerId} attempted non-battle action ${data.type} while in battle.`);
         return;
    }
    // Allow sending battle actions even if client thinks it's not in battle, server state is source of truth
    // No strict block for non-battle actions when not in battle is needed here


    switch (data.type) {
        case 'MOVE':
            handlePlayerMove(playerId, data.payload.direction);
            break;
        case 'INITIATE_DUEL':
             handleInitiateDuel(playerId, data.payload.targetId);
             break;
        case 'RESPOND_DUEL':
            handleRespondDuel(playerId, data.payload.challengerId, data.payload.accepted);
            break;
        // --- Battle Actions ---
        case 'SELECT_MOVE':
            if (player.inBattle && player.currentBattleId && activeBattles[player.currentBattleId]) {
                handlePlayerAction(playerId, player.currentBattleId, { type: 'move', moveName: data.payload.moveName });
            }
            break;
        case 'ATTEMPT_CATCH':
            if (player.inBattle && player.currentBattleId && activeBattles[player.currentBattleId]?.type === 'PvE') {
                handlePlayerAction(playerId, player.currentBattleId, { type: 'catch' });
            } else {
                 sendInfo(player.ws, "Cannot catch in this battle!");
            }
            break;
        case 'FLEE_BATTLE':
             if (player.inBattle && player.currentBattleId && activeBattles[player.currentBattleId]) {
                 handlePlayerAction(playerId, player.currentBattleId, { type: 'flee' });
             }
             break;
        // TODO: case 'SWAP_GENMON_BATTLE': handlePlayerAction(playerId, player.currentBattleId, { type: 'swap', teamIndex: data.payload.teamIndex }); break;

        // --- Team Management (Outside Battle) ---
        case 'SWAP_GENMON_TEAM':
             handleSwapGenmonTeam(playerId, data.payload.teamIndex);
             break;
         case 'RELEASE_GENMON':
             handleReleaseGenmon(playerId, data.payload.teamIndex);
             break;

        default:
            console.log(`Unknown message type from ${playerId}: ${data.type}`);
            sendInfo(player.ws, `Unknown action: ${data.type}`);
            break;
    }
}

// --- Player Disconnect ---
function handleDisconnect(playerId) {
    console.log(`Client disconnected: ${playerId}`);
    const player = players[playerId];
    if (!player) return;

    // If in battle, end it (opponent wins/wild battle ends)
    if (player.inBattle && player.currentBattleId) {
        const battle = activeBattles[player.currentBattleId];
        if (battle) {
            if (battle.type === 'PvP') {
                const opponentId = battle.player1Id === playerId ? battle.player2Id : battle.player1Id;
                // Set opponent as winner, disconnected player as loser, mark as forfeit
                handleBattleEnd(player.currentBattleId, opponentId, playerId, true);
            } else { // PvE
                // Wild battle simply ends, no winner/loser really matters unless tracking stats
                handleBattleEnd(player.currentBattleId, null, playerId, true); // Pass player ID as loser for logging consistency maybe
            }
        }
    }

    delete players[playerId];
    // Broadcast player leave
    broadcast({
        type: 'PLAYER_LEAVE',
        payload: { playerId: playerId }
    });
}

// --- Game Logic Functions ---

function handlePlayerMove(playerId, direction) {
    const player = players[playerId];
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
    player.direction = direction;

    // Check map boundaries
    if (targetX < 0 || targetX >= MAP_WIDTH || targetY < 0 || targetY >= MAP_HEIGHT) {
         broadcast({ type: 'PLAYER_UPDATE', payload: { player: getPublicPlayerData(playerId) } });
         return;
    }

    // Check tile type (collision)
    const targetTile = mapData[targetY][targetX];
    if (targetTile === TILE_OBSTACLE) {
         broadcast({ type: 'PLAYER_UPDATE', payload: { player: getPublicPlayerData(playerId) } }); // Still broadcast direction change
         sendInfo(player.ws, "Cannot move there!");
         return;
    }

    // Check for other players (basic collision)
    for (const pId in players) {
        if (pId !== playerId && players[pId].x === targetX && players[pId].y === targetY) {
            broadcast({ type: 'PLAYER_UPDATE', payload: { player: getPublicPlayerData(playerId) } });
            sendInfo(player.ws, "Another player is there!");
            return; // Collision with player
        }
    }

    // Move successful
    player.x = targetX;
    player.y = targetY;

    // Broadcast the move and direction update
    broadcast({
        type: 'PLAYER_UPDATE', // Use a general update message
        payload: { player: getPublicPlayerData(playerId) }
    });

    // Check for wild encounter if on grass
    if (targetTile === TILE_GRASS) {
        if (Math.random() < WILD_ENCOUNTER_CHANCE) {
            // Ensure player has fightable Genmon before starting
            const canFight = player.team.some(g => g.currentHp > 0);
            if (canFight) {
                 console.log(`Player ${playerId} triggered a wild encounter at (${player.x}, ${player.y})!`);
                 startWildBattle(playerId);
             } else {
                 sendInfo(player.ws, "You have no Genmon ready to fight!");
             }
        }
    }
}


// --- Wild Battle ---
function startWildBattle(playerId) {
    const player = players[playerId];
    // Double check player state
    if (!player || player.inBattle || player.team.length === 0) return;

     // Find first healthy Genmon to lead with
     const firstHealthyIndex = player.team.findIndex(g => g.currentHp > 0);
     if (firstHealthyIndex === -1) {
         sendInfo(player.ws, "All your Genmon have fainted!"); // Should be caught by move handler, but belt-and-suspenders
         return;
     }
     // Set the first healthy Genmon as active if the current one is fainted
     if (player.team[player.activeGenmonIndex].currentHp <= 0) {
         player.activeGenmonIndex = firstHealthyIndex;
         // Send update about the forced switch? Maybe not necessary here, battle start syncs team.
         player.ws.send(JSON.stringify({ type: 'TEAM_UPDATE', payload: { team: player.team, activeGenmonIndex: player.activeGenmonIndex } }));
     }


    // Select a random wild Genmon
    const availableGenmonIds = Object.keys(genmonData);
    const wildGenmonId = availableGenmonIds[Math.floor(Math.random() * availableGenmonIds.length)];
    const wildGenmonInstance = createGenmonInstance(wildGenmonId);
    if (!wildGenmonInstance) {
        console.error("Failed to create wild Genmon instance.");
        return;
    }

    const battleId = generateUniqueId();
    const playerActiveGenmon = player.team[player.activeGenmonIndex]; // Use the (potentially updated) active index


    activeBattles[battleId] = {
        id: battleId,
        type: 'PvE',
        playerId: playerId,
        wildGenmon: wildGenmonInstance, // Store the instance
        playerGenmonUniqueId: playerActiveGenmon.uniqueId, // Track which team member is out
        turn: playerId, // Player usually goes first (add speed check later)
        log: [`A wild ${wildGenmonInstance.name} appeared!`],
        turnNumber: 1,
        waitingForAction: playerId, // Set initial waiting player
        playerAction: null, // Store player's chosen action for the turn
        opponentAction: null // Store opponent's chosen action
    };

    player.inBattle = true;
    player.currentBattleId = battleId;

    const battleStartData = {
        type: 'WILD_BATTLE_START',
        payload: {
            battleId: battleId,
            playerGenmon: playerActiveGenmon,
            opponentGenmon: wildGenmonInstance,
            initialLog: activeBattles[battleId].log
        }
    };

    player.ws.send(JSON.stringify(battleStartData));
    broadcast({ type: 'PLAYER_IN_BATTLE', payload: { playerIds: [playerId] }}, null);

    requestPlayerAction(playerId, battleId);
}

// --- Duel (PvP) ---
function handleInitiateDuel(challengerId, targetId) {
    const challenger = players[challengerId];
    const target = players[targetId];

    if (!challenger || !target) return sendInfo(challenger?.ws, "Target player not found.");
    if (challengerId === targetId) return sendInfo(challenger.ws, "Cannot challenge yourself.");
    if (challenger.inBattle) return sendInfo(challenger.ws, "Cannot challenge while in battle.");
    if (target.inBattle) return sendInfo(challenger.ws, `${target.id} is already in a battle.`);
    if (challenger.team.length === 0 || !challenger.team.some(g => g.currentHp > 0)) return sendInfo(challenger.ws, "You need a healthy Genmon to battle.");
    if (target.team.length === 0 || !target.team.some(g => g.currentHp > 0)) return sendInfo(challenger.ws, `${target.id} has no healthy Genmon to battle.`);

    // Basic proximity check (optional)
    const distance = Math.abs(challenger.x - target.x) + Math.abs(challenger.y - target.y);
    if (distance > 3) { // Slightly larger range
        return sendInfo(challenger.ws, "Target is too far away.");
    }

    // Send challenge request
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
    const responder = players[responderId];
    const challenger = players[challengerId];

    if (!responder || !challenger) return; // One player might have disconnected

    if (accepted) {
        // Check again if players are still available and have healthy Genmon
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
    const player1 = players[player1Id];
    const player2 = players[player2Id];

     // Find first healthy Genmon for each player
     const p1HealthyIndex = player1.team.findIndex(g => g.currentHp > 0);
     const p2HealthyIndex = player2.team.findIndex(g => g.currentHp > 0);

     if (p1HealthyIndex === -1 || p2HealthyIndex === -1) {
         console.error("Duel start check failed: One player has no healthy Genmon.");
         sendInfo(player1.ws, "Duel cannot start: a player has no healthy Genmon.");
         sendInfo(player2.ws, "Duel cannot start: a player has no healthy Genmon.");
         return;
     }

     // Set active Genmon if current is fainted
     if (player1.team[player1.activeGenmonIndex].currentHp <= 0) player1.activeGenmonIndex = p1HealthyIndex;
     if (player2.team[player2.activeGenmonIndex].currentHp <= 0) player2.activeGenmonIndex = p2HealthyIndex;

     const p1Active = player1.team[player1.activeGenmonIndex];
     const p2Active = player2.team[player2.activeGenmonIndex];


    const battleId = generateUniqueId();
    // Determine turn based on speed
    const fasterPlayerId = p1Active.stats.spd >= p2Active.stats.spd ? player1Id : player2Id;

    activeBattles[battleId] = {
        id: battleId,
        type: 'PvP',
        player1Id: player1Id,
        player2Id: player2Id,
        p1GenmonUniqueId: p1Active.uniqueId,
        p2GenmonUniqueId: p2Active.uniqueId,
        turn: fasterPlayerId, // Who goes first in the turn
        waitingForAction: fasterPlayerId, // Whose action we are waiting for currently
        log: [`Duel started between ${player1Id} (${p1Active.name}) and ${player2Id} (${p2Active.name})!`],
        turnNumber: 1,
        playerAction: null, // Store player's chosen action for the turn
        opponentAction: null // Store opponent's chosen action
    };

    player1.inBattle = true;
    player1.currentBattleId = battleId;
    player2.inBattle = true;
    player2.currentBattleId = battleId;

    const battleStartData = {
        type: 'DUEL_START',
        payload: {
            battleId: battleId,
            player1: { id: player1Id, genmon: p1Active },
            player2: { id: player2Id, genmon: p2Active },
            initialLog: activeBattles[battleId].log
        }
    };

    player1.ws.send(JSON.stringify(battleStartData));
    player2.ws.send(JSON.stringify(battleStartData));

    broadcast({ type: 'PLAYER_IN_BATTLE', payload: { playerIds: [player1Id, player2Id] }}, null);

    requestPlayerAction(fasterPlayerId, battleId);
}

// --- Unified Battle Action Handling ---

function requestPlayerAction(playerId, battleId) {
    const battle = activeBattles[battleId];
    const player = players[playerId];
    if (!battle || !player) return;

    // Ensure the player we're requesting from is actually in the battle
    if (battle.type === 'PvP' && playerId !== battle.player1Id && playerId !== battle.player2Id) {
        console.error(`Requested action from ${playerId} who is not in PvP battle ${battleId}`);
        return;
    }
    if (battle.type === 'PvE' && playerId !== battle.playerId) {
        console.error(`Requested action from ${playerId} who is not in PvE battle ${battleId}`);
        return;
    }


    battle.waitingForAction = playerId; // Set who we are waiting for

    const payload = {
        battleId: battleId,
        playerId: playerId, // ID of player whose turn it is (or whose action is needed)
        turnNumber: battle.turnNumber
    };

    const message = { type: 'REQUEST_ACTION', payload };

    // Send request only to the player whose action is needed
    player.ws.send(JSON.stringify(message));

    console.log(`Battle ${battleId} Turn ${battle.turnNumber}: Waiting for action from ${playerId}`);

    // Inform the opponent(s) who's turn it is (optional, but good for UI)
    const waitingMessage = { type: 'INFO', payload: { message: `Waiting for ${playerId} to act...` } };
    if (battle.type === 'PvP') {
        const opponentId = (playerId === battle.player1Id) ? battle.player2Id : battle.player1Id;
        if (players[opponentId]?.ws?.readyState === WebSocket.OPEN) {
             players[opponentId].ws.send(JSON.stringify(waitingMessage));
        }
    }
    // No need to inform wild Genmon
}

function handlePlayerAction(playerId, battleId, action) {
    const battle = activeBattles[battleId];
    const player = players[playerId];

    if (!battle || !player) {
        console.log(`Action received for non-existent battle or player. Battle: ${battleId}, Player: ${playerId}`);
        return;
    }
    if (battle.waitingForAction !== playerId) {
        console.log(`Invalid action attempt by ${playerId} for battle ${battleId}. Waiting for ${battle.waitingForAction}. Action: ${action.type}`);
        sendInfo(player.ws, "It's not your turn to act or the battle is waiting for someone else!");
        return;
    }

    let attacker, defender, attackerGenmon, defenderGenmon;
    let turnLog = [];
    let battleEnded = false;
    let playerActionCompleted = false; // Flag to track if player's primary action is done

    // **** FIX: Declare damage and success with function scope ****
    let damage = 0;
    let success = false;

    // Identify participants
    if (battle.type === 'PvP') {
        const opponentId = battle.player1Id === playerId ? battle.player2Id : battle.player1Id;
        attacker = player;
        defender = players[opponentId];
        // Find the correct Genmon instance based on stored unique IDs
        attackerGenmon = attacker.team.find(g => g.uniqueId === (playerId === battle.player1Id ? battle.p1GenmonUniqueId : battle.p2GenmonUniqueId));
        defenderGenmon = defender?.team.find(g => g.uniqueId === (opponentId === battle.player1Id ? battle.p1GenmonUniqueId : battle.p2GenmonUniqueId));
    } else { // PvE
        attacker = player;
        defender = null; // Wild Genmon isn't a player object
        attackerGenmon = attacker.team.find(g => g.uniqueId === battle.playerGenmonUniqueId);
        defenderGenmon = battle.wildGenmon;
    }

    // Validate Genmon and HP
    if (!attackerGenmon) {
        console.error(`Error in battle ${battleId}: Attacker Genmon not found for player ${playerId} (UID: ${battle.type === 'PvP' ? (playerId === battle.player1Id ? battle.p1GenmonUniqueId : battle.p2GenmonUniqueId) : battle.playerGenmonUniqueId})`);
        sendInfo(player.ws, "Error: Your active Genmon couldn't be found.");
        handleBattleEnd(battleId, null, playerId, true); // End battle due to error
        return;
    }
     if (!defenderGenmon) {
         console.error(`Error in battle ${battleId}: Defender Genmon not found.`);
         // Determine winner based on context (if PvP, attacker wins, if PvE, attacker wins)
         handleBattleEnd(battleId, attacker.id, (battle.type === 'PvP' ? defender?.id : null), true);
         return;
     }
     if (attackerGenmon.currentHp <= 0 && action.type !== 'swap') { // Allow swapping fainted genmon
         sendInfo(player.ws, `${attackerGenmon.name} has fainted and cannot act! You must swap.`);
         // Server should have sent REQUEST_SWITCH, don't re-request action here.
         // The correct action is SWAP, so wait for that.
         // Reset waitingForAction might be needed if player spams wrong actions
         // battle.waitingForAction = playerId; // No, keep waiting for SWAP
         return;
     }

    // --- Process Action ---
    battle.waitingForAction = null; // Mark action as received/processing

    switch (action.type) {
        case 'move':
            const move = moveData[action.moveName];
            if (!move || !attackerGenmon.moves.includes(action.moveName)) {
                sendInfo(player.ws, `Invalid move: ${action.moveName}.`);
                battle.waitingForAction = playerId; // Re-request action from same player
                requestPlayerAction(playerId, battleId); // Ask again immediately
                return; // Stop processing this invalid action
            }

            // **** FIX: Assign to function-scoped variable ****
            damage = calculateDamage(attackerGenmon, defenderGenmon, move);
            defenderGenmon.currentHp = Math.max(0, defenderGenmon.currentHp - damage);
            turnLog.push(`${attackerGenmon.name} used ${action.moveName}!`);
            if (damage > 0) turnLog.push(`It dealt ${damage} damage to ${defenderGenmon.name}.`);
            else turnLog.push(`It had no effect or missed!`); // Covers miss and 0 damage

            if (defenderGenmon.currentHp <= 0) {
                turnLog.push(`${defenderGenmon.name} fainted!`);
                // Battle end logic will be checked later
            }
            playerActionCompleted = true;
            break;

        case 'catch':
            if (battle.type !== 'PvE') {
                 sendInfo(player.ws, "Cannot catch in this battle!");
                 battle.waitingForAction = playerId; // Re-request action
                 requestPlayerAction(playerId, battleId);
                 return;
            }

            turnLog.push(`${player.id} threw a Catch Device!`);
             // **** FIX: Assign to function-scoped variable ****
            success = calculateCatchSuccess(defenderGenmon);

            if (success) {
                turnLog.push(`Gotcha! ${defenderGenmon.name} was caught!`);
                // Battle end logic will be checked later
                if (player.team.length < 6) {
                    const caughtInstance = JSON.parse(JSON.stringify(defenderGenmon));
                    // Maybe reset HP/status of caught genmon? For now, add as is.
                    player.team.push(caughtInstance);
                    sendInfo(player.ws, `${caughtInstance.name} added to your team.`);
                    player.ws.send(JSON.stringify({ type: 'TEAM_UPDATE', payload: { team: player.team, activeGenmonIndex: player.activeGenmonIndex } }));
                } else {
                    turnLog.push(`But your team is full! ${defenderGenmon.name} was not added.`);
                    sendInfo(player.ws, `Team is full. ${defenderGenmon.name} was not added.`);
                }
            } else {
                turnLog.push(`Oh no! The Genmon broke free!`);
                // Player's action (catch attempt) is done. Wild Genmon gets a turn.
            }
            playerActionCompleted = true;
            break;

        case 'flee':
             turnLog.push(`${player.id} attempts to flee...`);
             if (battle.type === 'PvE') {
                 // Simple flee chance (maybe make dependent on speed later)
                 if (Math.random() < 0.6) { // 60% chance
                     turnLog.push("Got away safely!");
                     battleEnded = true; // Mark battle as ending due to successful flee
                 } else {
                     turnLog.push("Couldn't get away!");
                     // Player's action (flee attempt) is done. Wild Genmon gets a turn.
                 }
             } else { // PvP - Cannot flee
                 turnLog.push(`Cannot flee from a Trainer battle!`);
                 // Re-request action immediately as flee is invalid
                 battle.waitingForAction = playerId;
                 requestPlayerAction(playerId, battleId);
                 return; // Don't proceed to opponent turn or post-action updates
             }
             playerActionCompleted = true;
             break;

        // TODO: case 'swap': Implement swap logic (find new genmon, update battle state, log, etc.) playerActionCompleted = true; break;

        default:
            console.log(`Unhandled action type in handlePlayerAction: ${action.type}`);
             sendInfo(player.ws, `Unknown action: ${action.type}`);
            battle.waitingForAction = playerId; // Ask again
            requestPlayerAction(playerId, battleId);
            return;
    }

    // --- Post-Player-Action Update ---
    if (playerActionCompleted) {
        if (turnLog.length > 0) {
            battle.log.push(...turnLog);
            const updatePayload = {
                battleId: battleId,
                logUpdate: turnLog,
                attackerId: attacker.id,
                defenderId: battle.type === 'PvP' ? defender?.id : null, // Only relevant for PvP logging maybe
                playerGenmonUpdate: null,
                opponentGenmonUpdate: null
            };

             // Determine which genmon state needs sending based on the action
             if (action.type === 'move') {
                 // Defender's HP always changes (even if damage is 0, send state)
                  if (battle.type === 'PvP' && defenderGenmon) {
                      updatePayload.opponentGenmonUpdate = { uniqueId: defenderGenmon.uniqueId, currentHp: defenderGenmon.currentHp };
                 } else if (battle.type === 'PvE' && defenderGenmon) {
                      updatePayload.opponentGenmonUpdate = { uniqueId: defenderGenmon.uniqueId, currentHp: defenderGenmon.currentHp }; // Send wild genmon state
                 }
                 // Include attacker HP update if recoil/etc. occurs later
             } else if (action.type === 'catch' && !success) {
                  // No HP changes usually, just log update
             } else if (action.type === 'flee' && !battleEnded) {
                  // No HP changes, just log update
             }
              // If caught successfully, the battle ends before opponent turn, no update needed here?
              // The battle end message will handle the final state.

            const updateMessage = JSON.stringify({ type: 'BATTLE_UPDATE', payload: updatePayload });
            if (battle.type === 'PvP') {
                players[battle.player1Id]?.ws.send(updateMessage);
                players[battle.player2Id]?.ws.send(updateMessage);
            } else { // PvE
                attacker.ws.send(updateMessage);
            }
            console.log(`Battle ${battleId} (Player Turn):`, turnLog.join(' '));
        }

        // --- Check for Battle End Condition AFTER player action ---
        // Check if defender fainted (from move)
        if (action.type === 'move' && defenderGenmon.currentHp <= 0) {
             battleEnded = true;
             handleBattleEnd(battleId, attacker.id, (battle.type === 'PvP' ? defender.id : null));
             return; // Battle is over
        }
        // Check if successfully caught (from catch)
        if (action.type === 'catch' && success) {
            battleEnded = true;
            handleBattleEnd(battleId, attacker.id, null, false, true); // Winner is player, no loser, not forfeit, but caught=true
            return; // Battle is over
        }
        // Check if successfully fled (from flee)
        if (action.type === 'flee' && battleEnded) { // battleEnded flag was set inside flee case
            handleBattleEnd(battleId, null, attacker.id, true); // No winner, loser is player, forfeited=true
            return; // Battle is over
        }


        // --- Opponent's Turn (if applicable and battle not ended) ---
        if (!battleEnded) {
            let opponentShouldAct = false;
            let opponentId = null;
            let opponentGenmon = null;
            let playerGenmonForOpponent = attackerGenmon; // The Genmon the opponent will target

            if (battle.type === 'PvP') {
                // PvP: The other player gets a turn.
                opponentId = (playerId === battle.player1Id) ? battle.player2Id : battle.player1Id;
                opponentShouldAct = true; // Always switch turn in PvP for now (add speed calcs later)
                 battle.turn = opponentId; // Update whose turn it is conceptually
                 battle.waitingForAction = opponentId; // Set who we wait for next
                 requestPlayerAction(opponentId, battleId); // Request action from opponent
            } else { // PvE - Wild Genmon's turn
                opponentGenmon = battle.wildGenmon;
                // Wild acts if it's alive and player didn't just end the battle
                if (opponentGenmon.currentHp > 0) {
                    opponentShouldAct = true;

                    let wildTurnLog = [];
                    const wildMoveName = opponentGenmon.moves[Math.floor(Math.random() * opponentGenmon.moves.length)];
                    const wildMove = moveData[wildMoveName];

                    if (wildMove) {
                        const wildDamage = calculateDamage(opponentGenmon, playerGenmonForOpponent, wildMove);
                        playerGenmonForOpponent.currentHp = Math.max(0, playerGenmonForOpponent.currentHp - wildDamage);
                        wildTurnLog.push(`Wild ${opponentGenmon.name} used ${wildMoveName}!`);
                        if (wildDamage > 0) wildTurnLog.push(`It dealt ${wildDamage} damage to ${playerGenmonForOpponent.name}.`);
                        else wildTurnLog.push(`It had no effect or missed!`);

                        battle.log.push(...wildTurnLog);
                        const wildUpdatePayload = {
                            battleId: battleId, logUpdate: wildTurnLog, attackerId: null, // Indicate wild attacker
                            defenderId: attacker.id,
                            playerGenmonUpdate: { uniqueId: playerGenmonForOpponent.uniqueId, currentHp: playerGenmonForOpponent.currentHp },
                            opponentGenmonUpdate: { uniqueId: opponentGenmon.uniqueId, currentHp: opponentGenmon.currentHp } // Update wild state too
                        };
                        attacker.ws.send(JSON.stringify({ type: 'BATTLE_UPDATE', payload: wildUpdatePayload }));
                        console.log(`Battle ${battleId} (Wild Turn):`, wildTurnLog.join(' '));

                        // --- Check for Battle End Condition AFTER opponent action ---
                        if (playerGenmonForOpponent.currentHp <= 0) {
                             wildTurnLog.push(`${playerGenmonForOpponent.name} fainted!`); // Log added to main battle log above
                             // Check if player has more Genmon
                             const hasMoreGenmon = player.team.some(g => g.currentHp > 0 && g.uniqueId !== playerGenmonForOpponent.uniqueId);
                             if (!hasMoreGenmon) {
                                  wildTurnLog.push(`${player.id} has no more Genmon left to fight!`);
                                   // Send final log update before ending
                                  attacker.ws.send(JSON.stringify({ type: 'BATTLE_UPDATE', payload: { battleId: battleId, logUpdate: [`${playerGenmonForOpponent.name} fainted!`, `${player.id} has no more Genmon left to fight!`] } }));
                                  handleBattleEnd(battleId, null, playerId); // Player loses
                                  return; // Battle over
                             } else {
                                 // Prompt player to switch
                                  player.ws.send(JSON.stringify({ type: 'REQUEST_SWITCH', payload: { battleId: battleId, reason: "Your Genmon fainted!"} }));
                                  battle.waitingForAction = playerId; // Waiting for player SWAP action
                                  console.log(`Battle ${battleId}: Requesting switch from ${playerId}`);
                                  return; // Stop turn progression, wait for swap
                             }
                        }
                    } else {
                         console.error(`Battle ${battleId}: Wild Genmon ${opponentGenmon.name} has invalid move ${wildMoveName}`);
                          wildTurnLog.push(`Wild ${opponentGenmon.name} seems confused!`); // Handle gracefully
                           battle.log.push(...wildTurnLog);
                           attacker.ws.send(JSON.stringify({ type: 'BATTLE_UPDATE', payload: { battleId: battleId, logUpdate: wildTurnLog } }));
                    }
                } // End if wild is alive

                 // If wild acted and didn't faint the player/force a switch, it's player's turn again
                 if (battle.waitingForAction !== playerId) { // Check if waiting state was changed by faint logic
                     battle.turn = playerId; // Player's turn again
                     battle.turnNumber++; // Increment turn number after player/wild exchange completes
                     requestPlayerAction(playerId, battleId);
                 }

            } // End PvE opponent logic

        } // End if !battleEnded

    } // End if playerActionCompleted

     // This part handles cases where an invalid action was attempted and we re-requested immediately
     else if (!playerActionCompleted && battle.waitingForAction === playerId) {
         // This case happens if an invalid action (like flee in PvP, or bad move name)
         // caused `requestPlayerAction` to be called again within the same function execution.
         // We already re-requested the action, so just log and wait.
         console.log(`Battle ${battleId}: Waiting for re-requested action from ${playerId} after invalid attempt.`);
     }
}


function handleBattleEnd(battleId, winnerId, loserId, forfeited = false, caught = false) {
    const battle = activeBattles[battleId];
    if (!battle) return;

    // Prevent double execution if called multiple times rapidly
    if (battle.ended) return;
    battle.ended = true; // Mark as ended

    console.log(`Ending battle ${battleId}. Winner: ${winnerId}, Loser: ${loserId}, Forfeit: ${forfeited}, Caught: ${caught}`);

    let finalMessage = "";
    let playerLost = false; // Track if the primary player lost (for PvE end message)

    if (battle.type === 'PvP') {
        const winner = players[winnerId];
        const loser = players[loserId];

        if (winnerId && loserId) {
            const loserGenmon = loser?.team.find(g => g.uniqueId === (loserId === battle.player1Id ? battle.p1GenmonUniqueId : battle.p2GenmonUniqueId));
            finalMessage = forfeited
                ? `${loserId} forfeited or disconnected! ${winnerId} wins!`
                : `${loserGenmon?.name || 'Opponent\'s Genmon'} fainted! ${winnerId} wins the duel!`;
        } else if (winnerId) {
             finalMessage = `${winnerId} wins the duel due to opponent disconnect or error!`;
        } else if (loserId) {
             finalMessage = `${loserId} lost the duel due to disconnect or error!`;
        } else {
             finalMessage = "The duel ended unexpectedly."; // Draw or error
        }

    } else { // PvE
        const wildName = battle.wildGenmon.name;
        const playerId = battle.playerId;

        if (caught) {
            finalMessage = `${wildName} was caught!`;
        } else if (winnerId === playerId) { // Player won by fainting wild
            finalMessage = `${playerId} defeated the wild ${wildName}!`;
        } else { // Player lost or fled
            playerLost = (loserId === playerId);
             if (forfeited) {
                 finalMessage = `${playerId} got away safely.`;
             } else if (playerLost) {
                 finalMessage = `${playerId} was defeated by the wild ${wildName}!`;
                 // Add logic for "whiting out" later
             } else {
                 // Wild won but player didn't explicitly lose? (Shouldn't happen with current logic)
                 finalMessage = `The battle with the wild ${wildName} ended.`;
             }
        }
    }

    // Add final message to log if not already present
    if (!battle.log.some(msg => msg.includes(finalMessage.substring(0, 20)))) { // Check partial message to avoid slight variations
         battle.log.push(finalMessage);
    }

    const battleEndData = {
        type: 'BATTLE_END',
        payload: {
            battleId: battleId,
            battleType: battle.type,
            winnerId: winnerId,
            loserId: loserId,
            forfeited: forfeited,
            caught: caught,
            finalLog: battle.log // Send the complete log
        }
    };

    // Notify involved players and update their state
    const playerIdsInvolved = battle.type === 'PvP' ? [battle.player1Id, battle.player2Id] : [battle.playerId];
    playerIdsInvolved.forEach(pId => {
        const player = players[pId];
        if (player) {
            player.inBattle = false;
            player.currentBattleId = null;
             // Ensure team HP is updated before sending final state
             // (It should be updated during the battle updates, but double check)
            if (player.ws && player.ws.readyState === WebSocket.OPEN) {
                 player.ws.send(JSON.stringify(battleEndData));
                 // Send final team state, especially HP after battle
                 player.ws.send(JSON.stringify({ type: 'TEAM_UPDATE', payload: { team: player.team, activeGenmonIndex: player.activeGenmonIndex } }));
             }
        }
    });

    // Remove battle from active battles *after* notifying players
    delete activeBattles[battleId];

    // Notify others that these players are no longer in battle
    broadcast({ type: 'PLAYER_BATTLE_END', payload: { playerIds: playerIdsInvolved }}, null);

    console.log(`Battle ${battleId} officially ended. Final message logged: ${finalMessage}`);
}

// --- Team Management ---
function handleSwapGenmonTeam(playerId, teamIndex) {
    const player = players[playerId];
    if (!player || player.inBattle) return sendInfo(player?.ws, "Cannot swap team members right now.");
    if (teamIndex < 0 || teamIndex >= player.team.length) {
        return sendInfo(player.ws, "Invalid team index.");
    }
    if (player.team[teamIndex].currentHp <= 0) {
        return sendInfo(player.ws, "Cannot switch to a fainted Genmon outside of battle.");
    }
     if (player.activeGenmonIndex === teamIndex) {
         return sendInfo(player.ws, `${player.team[teamIndex].name} is already active.`);
     }

    player.activeGenmonIndex = teamIndex;
    sendInfo(player.ws, `Switched active Genmon to ${player.team[teamIndex].name}.`);
    // Send updated team state
    player.ws.send(JSON.stringify({ type: 'TEAM_UPDATE', payload: { team: player.team, activeGenmonIndex: player.activeGenmonIndex } }));
     // Also update public data for sprite change
     broadcast({ type: 'PLAYER_UPDATE', payload: { player: getPublicPlayerData(playerId) } });
}

function handleReleaseGenmon(playerId, teamIndex) {
    const player = players[playerId];
    if (!player || player.inBattle) return sendInfo(player?.ws, "Cannot release Genmon right now.");
    if (player.team.length <= 1) {
        return sendInfo(player.ws, "Cannot release your last Genmon!");
    }
    if (teamIndex < 0 || teamIndex >= player.team.length) {
        return sendInfo(player.ws, "Invalid team index.");
    }
     // Prevent releasing the currently active Genmon? Maybe allow it but force switch?
     // For now, allow releasing active, but adjust index carefully.

    const releasedGenmon = player.team.splice(teamIndex, 1)[0];
    sendInfo(player.ws, `${releasedGenmon.name} was released.`);

    // Adjust active index if the released Genmon was the active one or before it
    if (player.activeGenmonIndex === teamIndex) {
         // If the active one was released, default to the first one (index 0)
         // Or find the next available healthy one? Let's default to 0 for simplicity.
         player.activeGenmonIndex = 0;
         // Ensure the new active Genmon (index 0) is healthy, otherwise player might get stuck
         if (player.team.length > 0 && player.team[0].currentHp <= 0) {
             // Find first healthy one if index 0 is fainted
              const firstHealthy = player.team.findIndex(g => g.currentHp > 0);
              player.activeGenmonIndex = (firstHealthy !== -1) ? firstHealthy : 0; // Default to 0 if none healthy
         }

    } else if (player.activeGenmonIndex > teamIndex) {
         // If a Genmon *before* the active one was released, decrement the active index
         player.activeGenmonIndex--;
    }
     // No change needed if a Genmon *after* the active one was released

    // Send updated team state
    player.ws.send(JSON.stringify({ type: 'TEAM_UPDATE', payload: { team: player.team, activeGenmonIndex: player.activeGenmonIndex } }));
    // Update public data if the active genmon's sprite might have changed
    broadcast({ type: 'PLAYER_UPDATE', payload: { player: getPublicPlayerData(playerId) } });
}


// --- HP Regeneration ---
function regenerateHp() {
    let updatedPlayers = {}; // Track players whose HP changed

    for (const playerId in players) {
        const player = players[playerId];
        // Regenerate HP only if OUTSIDE of battle
        if (!player.inBattle && player.team) {
            let changed = false;
            player.team.forEach(genmon => {
                if (genmon.currentHp > 0 && genmon.currentHp < genmon.stats.hp) {
                    genmon.currentHp = Math.min(genmon.stats.hp, genmon.currentHp + HEAL_AMOUNT);
                    changed = true;
                }
            });
            if (changed) {
                updatedPlayers[playerId] = true;
            }
        }
    }

    // Send updates only to players whose HP regenerated
    for (const playerId in updatedPlayers) {
        const player = players[playerId];
        if (player && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(JSON.stringify({
                type: 'TEAM_UPDATE',
                payload: {
                    team: player.team,
                    activeGenmonIndex: player.activeGenmonIndex
                }
            }));
            // console.log(`Sent HP regen update to ${playerId}`);
        }
    }
}


// --- Utility Functions ---

function broadcast(message, senderWs = null) {
    const messageString = JSON.stringify(message);
    wss.clients.forEach(client => {
        // Find player associated with this client WS instance
        let clientPlayerId = null;
        for(const id in players) {
            if (players[id].ws === client) {
                clientPlayerId = id;
                break;
            }
        }

        // Send if client is ready and is not the sender (if senderWs provided)
        if (client.readyState === WebSocket.OPEN && client !== senderWs) {
            // console.log(`Broadcasting to ${clientPlayerId || 'unknown client'}: ${message.type}`); // Debug broadcast
             client.send(messageString);
        }
    });
}


// Get simplified player data for broadcasting
function getPublicPlayerData(playerId = null) {
     const getData = (p) => {
         if (!p) return null;
         // Handle case where player might have no team or no healthy genmon temporarily
         const activeGenmon = (p.team && p.team.length > p.activeGenmonIndex)
                               ? p.team[p.activeGenmonIndex]
                               : null;

         const sprite = activeGenmon?.sprite || '/assets/default_player.png'; // Fallback sprite
         const genmonName = activeGenmon?.name || "---";

         return {
             id: p.id,
             x: p.x,
             y: p.y,
             direction: p.direction,
             sprite: sprite, // Use active genmon's sprite for map marker
             inBattle: p.inBattle,
             genmonName: genmonName // Name of active genmon
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
    const p = players[playerId];
    if (!p) return null;
    return {
        id: p.id,
        x: p.x,
        y: p.y,
        direction: p.direction,
        team: p.team, // Full team data
        activeGenmonIndex: p.activeGenmonIndex,
        inBattle: p.inBattle,
        currentBattleId: p.currentBattleId
    };
}

// Send simple info message to a specific client
function sendInfo(ws, message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'INFO', payload: { message } }));
    } else {
         console.log(`Attempted to send info to closed/invalid WS: ${message}`);
    }
}


// --- Start Server ---
server.listen(PORT, () => {
    console.log(`HTTP server listening on http://localhost:${PORT}`);
});