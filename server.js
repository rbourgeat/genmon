const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { genmonData, moveData, calculateDamage } = require('./data/genmonData');

const PORT = process.env.PORT || 3000;

// --- Simple HTTP Server to serve frontend files ---
const server = http.createServer((req, res) => {
    let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
    let extname = String(path.extname(filePath)).toLowerCase();
    let contentType = 'text/html';
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        // Add other necessary mime types
    };

    contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code == 'ENOENT') {
                // Simple fallback for assets (adjust as needed)
                filePath = path.join(__dirname, 'public/assets', path.basename(req.url));
                 fs.readFile(filePath, (assetError, assetContent) => {
                     if(assetError){
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

let players = {}; // Store player data { id: { ws, x, y, genmon, currentHp, ... } }
let battleState = { // Simple state for a 1v1 battle
    active: false,
    player1Id: null,
    player2Id: null,
    turn: null, // whose turn it is (player1Id or player2Id)
    waitingForMove: null, // ID of player whose move is awaited
    log: []
};
const ARENA_WIDTH = 10;
const ARENA_HEIGHT = 10;

console.log(`WebSocket server started on port ${PORT}`);

wss.on('connection', (ws) => {
    const playerId = generateUniqueId();
    console.log(`Client connected: ${playerId}`);

    // Initialize player state
    const startX = Math.floor(Math.random() * ARENA_WIDTH);
    const startY = Math.floor(Math.random() * ARENA_HEIGHT);
    // Assign a default Genmon (simple example)
    const playerGenmon = JSON.parse(JSON.stringify(Object.values(genmonData)[Math.random() < 0.5 ? 0 : 1])); // Deep copy Pikachu or Charmander

    players[playerId] = {
        ws: ws,
        id: playerId,
        x: startX,
        y: startY,
        genmon: playerGenmon,
        currentHp: playerGenmon.stats.hp, // Track current HP separately
        inBattle: false
    };

    // Send initial state to the new player
    ws.send(JSON.stringify({
        type: 'INIT',
        payload: {
            playerId: playerId,
            players: getPublicPlayerData(), // Send simplified data of others
            arenaWidth: ARENA_WIDTH,
            arenaHeight: ARENA_HEIGHT,
            yourGenmon: players[playerId].genmon, // Send full data for own genmon
            yourCurrentHp: players[playerId].currentHp
        }
    }));

    // Broadcast new player connection to others
    broadcast({
        type: 'PLAYER_JOIN',
        payload: { player: getPublicPlayerData(playerId) }
    }, ws); // Exclude sender

    // Handle messages from the client
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            // console.log(`Received from ${playerId}:`, data); // Debugging

            switch (data.type) {
                case 'MOVE':
                    handlePlayerMove(playerId, data.payload.direction);
                    break;
                case 'START_BATTLE':
                     // Very basic: Initiate battle if two players are close
                    // A real app needs a better initiation mechanism (challenge button etc.)
                    initiateBattleIfClose(playerId);
                    break;
                 case 'SELECT_MOVE':
                    if (battleState.active && battleState.waitingForMove === playerId && data.payload.moveName) {
                        handlePlayerAttack(playerId, data.payload.moveName);
                    }
                    break;
                // Add other message types (e.g., CHAT, USE_ITEM)
            }
        } catch (error) {
            console.error(`Failed to parse message or handle request from ${playerId}:`, error);
        }
    });

    // Handle disconnection
    ws.on('close', () => {
        console.log(`Client disconnected: ${playerId}`);
        // If in battle, handle forfeit/end
        if (players[playerId]?.inBattle) {
             handleBattleEnd(playerId, true); // true indicates forfeit
        }
        delete players[playerId];
        // Broadcast player leave
        broadcast({
            type: 'PLAYER_LEAVE',
            payload: { playerId: playerId }
        });
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for ${playerId}:`, error);
        // Handle disconnection due to error
        if (players[playerId]?.inBattle) {
            handleBattleEnd(playerId, true);
        }
        delete players[playerId];
         broadcast({
            type: 'PLAYER_LEAVE',
            payload: { playerId: playerId }
        });
    });
});

// --- Game Logic Functions ---

function handlePlayerMove(playerId, direction) {
    const player = players[playerId];
    if (!player || player.inBattle) return; // Cannot move if in battle

    let { x, y } = player;
    switch (direction) {
        case 'up':    y = Math.max(0, y - 1); break;
        case 'down':  y = Math.min(ARENA_HEIGHT - 1, y + 1); break;
        case 'left':  x = Math.max(0, x - 1); break;
        case 'right': x = Math.min(ARENA_WIDTH - 1, x + 1); break;
    }

     // Basic collision detection (can't move into another player's spot)
    let collision = false;
    for (const pId in players) {
        if (pId !== playerId && players[pId].x === x && players[pId].y === y) {
            collision = true;
            break;
        }
    }

    if (!collision) {
        player.x = x;
        player.y = y;

        // Broadcast the move
        broadcast({
            type: 'PLAYER_MOVE',
            payload: { playerId: playerId, x: player.x, y: player.y }
        });
    } else {
        // Optionally send a 'MOVE_FAILED' message back to the player
         player.ws.send(JSON.stringify({ type: 'INFO', payload: { message: "Cannot move there!" }}));
    }
}

function initiateBattleIfClose(initiatorId) {
    const initiator = players[initiatorId];
    if (!initiator || initiator.inBattle) return;

    for (const targetId in players) {
        if (targetId !== initiatorId && !players[targetId].inBattle) {
            const target = players[targetId];
            const distance = Math.abs(initiator.x - target.x) + Math.abs(initiator.y - target.y);

            // If players are adjacent, start a battle (simple trigger)
            if (distance <= 1 && !battleState.active) {
                startBattle(initiatorId, targetId);
                break; // Only start one battle at a time
            }
        }
    }
}

function startBattle(player1Id, player2Id) {
    console.log(`Starting battle between ${player1Id} and ${player2Id}`);
    const player1 = players[player1Id];
    const player2 = players[player2Id];

    if (!player1 || !player2 || player1.inBattle || player2.inBattle || battleState.active) {
        console.log("Cannot start battle: Players not available or battle already active.");
        // Send message back if needed
        return;
    }

    battleState = {
        active: true,
        player1Id: player1Id,
        player2Id: player2Id,
        turn: player1.genmon.stats.spd >= player2.genmon.stats.spd ? player1Id : player2Id, // Faster Genmon goes first
        waitingForMove: null, // Will be set in nextTurn
        log: [`Battle started between ${player1.genmon.name} and ${player2.genmon.name}!`],
        turnNumber: 1
    };

    player1.inBattle = true;
    player2.inBattle = true;
    player1.currentHp = player1.genmon.stats.hp; // Reset HP at battle start
    player2.currentHp = player2.genmon.stats.hp;


    const battleStartData = {
        type: 'BATTLE_START',
        payload: {
            player1: { id: player1Id, name: player1.genmon.name, maxHp: player1.genmon.stats.hp, currentHp: player1.currentHp, sprite: player1.genmon.sprite, moves: player1.genmon.moves },
            player2: { id: player2Id, name: player2.genmon.name, maxHp: player2.genmon.stats.hp, currentHp: player2.currentHp, sprite: player2.genmon.sprite, moves: player2.genmon.moves },
            initialLog: battleState.log
        }
    };

    // Send battle start info to both players
    player1.ws.send(JSON.stringify(battleStartData));
    player2.ws.send(JSON.stringify(battleStartData));

    // Inform other players someone entered battle (optional, hide them?)
     broadcast({ type: 'PLAYER_IN_BATTLE', payload: { playerIds: [player1Id, player2Id] }}, null);


    // Start the first turn
    nextTurn();
}

function handlePlayerAttack(attackerId, moveName) {
    if (!battleState.active || battleState.waitingForMove !== attackerId) return;

    const attacker = players[attackerId];
    const defenderId = attackerId === battleState.player1Id ? battleState.player2Id : battleState.player1Id;
    const defender = players[defenderId];

    if (!attacker || !defender) {
        console.error("Attacker or defender not found in battle!");
        handleBattleEnd(attackerId === battleState.player1Id ? battleState.player2Id : battleState.player1Id, true); // End battle if a player is missing
        return;
    }

    const move = moveData[moveName];
    if (!move || !attacker.genmon.moves.includes(moveName)) {
        // Invalid move selected, maybe ask again? For simplicity, log error and skip turn (or end battle)
        console.error(`Player ${attackerId} selected invalid move: ${moveName}`);
         attacker.ws.send(JSON.stringify({ type: 'INFO', payload: { message: `Invalid move: ${moveName}. Please choose again.` }}));
         requestMove(attackerId); // Ask the same player again
        return;
    }

    const damage = calculateDamage(attacker.genmon, defender.genmon, move);
    defender.currentHp = Math.max(0, defender.currentHp - damage);

    const attackLog = `${attacker.genmon.name} used ${moveName}! It dealt ${damage} damage.`;
    battleState.log.push(attackLog);
    console.log(attackLog);


     const turnResult = {
        type: 'BATTLE_UPDATE',
        payload: {
            attackerId: attackerId,
            defenderId: defenderId,
            moveUsed: moveName,
            damageDealt: damage,
            defenderCurrentHp: defender.currentHp,
            logUpdate: attackLog,
            // animationHint: move.animation // Add animation hints later
        }
    };
    // Send update to both players
    players[battleState.player1Id].ws.send(JSON.stringify(turnResult));
    players[battleState.player2Id].ws.send(JSON.stringify(turnResult));

    // Check for faint
    if (defender.currentHp <= 0) {
        const faintLog = `${defender.genmon.name} fainted!`;
        battleState.log.push(faintLog);
        console.log(faintLog)
        handleBattleEnd(defenderId); // defenderId is the loser
    } else {
        // Switch turn
        battleState.turn = defenderId;
        nextTurn();
    }
}


function nextTurn() {
    if (!battleState.active) return;

    const currentPlayerId = battleState.turn;
     battleState.waitingForMove = currentPlayerId;

    const turnInfo = {
        type: 'REQUEST_MOVE',
        payload: {
            playerId: currentPlayerId,
            turnNumber: battleState.turnNumber,
            message: `It's ${players[currentPlayerId].genmon.name}'s turn!`
        }
    }
    // Send to both players so they know whose turn it is
    players[battleState.player1Id].ws.send(JSON.stringify(turnInfo));
    players[battleState.player2Id].ws.send(JSON.stringify(turnInfo));

    console.log(`Turn ${battleState.turnNumber}: Waiting for move from ${currentPlayerId}`);
     battleState.turnNumber++; // Increment for next turn
}

function requestMove(playerId) {
     if (!battleState.active) return;
     battleState.waitingForMove = playerId;
     const turnInfo = {
        type: 'REQUEST_MOVE',
        payload: {
            playerId: playerId,
            turnNumber: battleState.turnNumber -1, // Keep same turn number if re-requesting
            message: `Please select a valid move for ${players[playerId].genmon.name}.`
        }
    }
    players[battleState.player1Id].ws.send(JSON.stringify(turnInfo));
    players[battleState.player2Id].ws.send(JSON.stringify(turnInfo));
}


function handleBattleEnd(loserId, forfeited = false) {
    if (!battleState.active) return;

    const winnerId = loserId === battleState.player1Id ? battleState.player2Id : battleState.player1Id;
    const winner = players[winnerId];
    const loser = players[loserId];

    let endMessage = forfeited
        ? `${loser?.genmon?.name || 'Opponent'} forfeited! ${winner?.genmon?.name || 'You'} wins!`
        : `${loser?.genmon?.name || 'Opponent'} fainted! ${winner?.genmon?.name || 'You'} wins!`;

    battleState.log.push(endMessage);
    console.log(endMessage);

    const battleEndData = {
        type: 'BATTLE_END',
        payload: {
            winnerId: winnerId,
            loserId: loserId,
            finalLog: battleState.log,
            forfeited: forfeited
        }
    };

     // Reset player states and send end message
    [winner, loser].forEach(p => {
        if (p && p.ws.readyState === WebSocket.OPEN) {
            p.inBattle = false;
            // Keep current HP as is after battle for now
            // p.currentHp = p.genmon.stats.hp; // Or reset HP
            p.ws.send(JSON.stringify(battleEndData));
        }
    });

     // Inform others the battle is over
     broadcast({ type: 'PLAYER_BATTLE_END', payload: { playerIds: [winnerId, loserId] }}, null);


    // Reset battle state
    battleState = { active: false, player1Id: null, player2Id: null, turn: null, waitingForMove: null, log: [] };

    console.log("Battle ended.");
}


// --- Utility Functions ---

function generateUniqueId() {
    return Math.random().toString(36).substring(2, 9);
}

// Broadcast message to all connected clients (optionally exclude one)
function broadcast(message, senderWs = null) {
    const messageString = JSON.stringify(message);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client !== senderWs) {
            client.send(messageString);
        }
    });
}

// Get simplified player data for broadcasting (avoid sending sensitive info like WebSocket object)
function getPublicPlayerData(playerId = null) {
    if (playerId) {
        const p = players[playerId];
        if (!p) return null;
        return { id: p.id, x: p.x, y: p.y, genmonName: p.genmon.name, sprite: p.genmon.sprite, inBattle: p.inBattle };
    } else {
        const publicData = {};
        for (const id in players) {
            publicData[id] = { id: players[id].id, x: players[id].x, y: players[id].y, genmonName: players[id].genmon.name, sprite: players[id].genmon.sprite, inBattle: players[id].inBattle };
        }
        return publicData;
    }
}


// --- Start Server ---
server.listen(PORT, () => {
    console.log(`HTTP server listening on http://localhost:${PORT}`);
});