const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Game Logic Modules
const gameState = require('./game/gameState');
const { generateUniqueId, sendInfo, broadcast } = require('./game/utils');
const { mapData, TILE_OBSTACLE, MAP_WIDTH, MAP_HEIGHT } = require('./game/constants');
const { getPublicPlayerData, getPrivatePlayerData, handleSwapGenmonTeam, handleReleaseGenmon } = require('./game/player');
const { handlePlayerMove } = require('./game/map');
const {
    startWildBattle,
    handleInitiateDuel,
    handleRespondDuel,
    startDuel,
    requestPlayerAction,
    handlePlayerAction, // Handles multiple action types now
    handleBattleEnd,
    handlePlayerDisconnectBattle,
} = require('./game/battle');
const { createGenmonInstance, genmonData } = require('./data/genmonData'); // Import base data if needed for starting team

const PORT = process.env.PORT || 3000;

// --- Simple HTTP Server --- (Serves static files from public/)
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
                // If file not found, try serving index.html (for SPA routing)
                fs.readFile(path.join(__dirname, 'public', 'index.html'), (err, indexContent) => {
                     if (err) {
                         res.writeHead(404, { 'Content-Type': 'text/html' });
                         res.end('404 Not Found');
                     } else {
                         res.writeHead(200, { 'Content-Type': 'text/html' });
                         res.end(indexContent, 'utf-8');
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
console.log(`WebSocket server started on port ${PORT}`);

wss.on('connection', (ws) => {
    const playerId = generateUniqueId();
    console.log(`Client connected: ${playerId}`);

    // Add reference to the server instance on the WebSocket object
    // This allows broadcast function in utils to access wss.clients
    ws.server = wss;

    // Find a valid starting position (not obstacle)
    let startX, startY;
    do {
        startX = Math.floor(Math.random() * MAP_WIDTH);
        startY = Math.floor(Math.random() * MAP_HEIGHT);
    } while (mapData[startY][startX] === TILE_OBSTACLE);

    // Assign starting Genmon team
    // Ensure starting team always has at least one Genmon
    const availableGenmonIds = Object.keys(genmonData);
    let startingTeam = [];
    if (availableGenmonIds.length > 0) {
        const startingGenmonId = availableGenmonIds[Math.floor(Math.random() * availableGenmonIds.length)];
        const startingGenmonInstance = createGenmonInstance(startingGenmonId);
        if (startingGenmonInstance) {
            startingTeam.push(startingGenmonInstance);
        }
    }
    // Add a default if creation failed or no data available? For robustness:
    if (startingTeam.length === 0) {
         console.warn("Could not create starting Genmon. Player will start with an empty team.");
         // Or force a default like: const defaultInstance = createGenmonInstance("Flufflame"); if (defaultInstance) startingTeam.push(defaultInstance);
    }


    // Store player data in central state
    const playerData = {
        ws: ws,
        id: playerId,
        x: startX,
        y: startY,
        direction: 'down', // Default direction
        team: startingTeam,
        activeGenmonIndex: 0,
        inBattle: false,
        currentBattleId: null
    };
    gameState.addPlayer(playerId, playerData);

    // Send initial state to the new player
    ws.send(JSON.stringify({
        type: 'INIT',
        payload: {
            playerId: playerId,
            players: getPublicPlayerData(), // Send simplified data of others
            mapData: mapData, // Send map data
            yourPlayer: getPrivatePlayerData(playerId) // Send detailed own data
        }
    }));

    // Broadcast new player connection to others
    broadcast(wss, gameState.getAllPlayers(), {
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
            console.error(`Failed to parse message or handle request from ${playerId}:`, message, error);
            sendInfo(ws, `Server error processing your request: ${error.message}`);
        }
    });

    // Handle disconnection
    ws.on('close', () => handleDisconnect(playerId));
    ws.on('error', (error) => {
         console.error(`WebSocket error for ${playerId}:`, error);
         handleDisconnect(playerId); // Treat error as disconnect
     });
});

// --- Message Router ---
function handleClientMessage(playerId, data) {
    const player = gameState.getPlayer(playerId);
    if (!player) {
        console.log(`Message received from disconnected or unknown player ${playerId}: ${data.type}`);
        return;
    }

    // Refined check: Allow SWAP_GENMON_BATTLE only when in battle AND expecting an action or switch
    const battle = player.inBattle ? gameState.getBattle(player.currentBattleId) : null;

    // Actions allowed only IN battle
    const battleActions = ['SELECT_MOVE', 'ATTEMPT_CATCH', 'SWAP_GENMON_BATTLE', 'FLEE_BATTLE'];
    // Actions allowed only OUTSIDE battle
    const nonBattleActions = ['MOVE', 'INITIATE_DUEL', 'RESPOND_DUEL', 'SWAP_GENMON_TEAM', 'RELEASE_GENMON'];

    // Basic checks
    if (player.inBattle && nonBattleActions.includes(data.type)) {
        sendInfo(player.ws, `Action ${data.type} not allowed during battle.`);
        console.log(`Player ${playerId} attempted non-battle action ${data.type} while in battle.`);
        return;
    }
    if (!player.inBattle && battleActions.includes(data.type)) {
        sendInfo(player.ws, `Action ${data.type} only allowed during battle.`);
        console.log(`Player ${playerId} attempted battle action ${data.type} while not in battle.`);
        return;
    }
    // Specific battle action check: Can only act if it's your turn or you need to switch
     if (battle && battleActions.includes(data.type)) {
         const isWaitingForPlayer = battle.waitingForAction === playerId;
         // Exception: Allow SWAP_GENMON_BATTLE even if not strictly waitingForAction if player *must* switch (e.g. after faint)
         const mustSwitch = battle.type === 'PvP'
             ? (playerId === battle.player1Id && battle.p1MustSwitch) || (playerId === battle.player2Id && battle.p2MustSwitch)
             : (playerId === battle.playerId && battle.p1MustSwitch); // Assuming p1 is always the player in PvE

         if (!isWaitingForPlayer && !(data.type === 'SWAP_GENMON_BATTLE' && mustSwitch)) {
             console.log(`Player ${playerId} action ${data.type} received, but not waiting for their action.`);
             sendInfo(player.ws, `Not currently waiting for your action.`);
             return;
         }
     }


    switch (data.type) {
        // --- Map Actions ---
        case 'MOVE':
            handlePlayerMove(playerId, data.payload.direction);
            break;

        // --- Duel Actions ---
        case 'INITIATE_DUEL':
            handleInitiateDuel(playerId, data.payload.targetId);
            break;
        case 'RESPOND_DUEL':
            handleRespondDuel(playerId, data.payload.challengerId, data.payload.accepted);
            break;

        // --- Battle Actions ---
        // Forward all valid battle actions to handlePlayerAction
        case 'SELECT_MOVE':
             if (player.inBattle && player.currentBattleId) {
                handlePlayerAction(playerId, player.currentBattleId, { type: 'move', moveName: data.payload.moveName });
             }
             break;
        case 'ATTEMPT_CATCH':
             if (player.inBattle && player.currentBattleId) {
                 const battle = gameState.getBattle(player.currentBattleId);
                 if (battle && battle.type === 'PvE') {
                     handlePlayerAction(playerId, player.currentBattleId, { type: 'catch' });
                 } else {
                     sendInfo(player.ws, "Cannot catch in this type of battle!");
                 }
             }
             break;
        case 'FLEE_BATTLE':
             if (player.inBattle && player.currentBattleId) {
                 const battle = gameState.getBattle(player.currentBattleId);
                  if (battle && battle.type === 'PvE') { // Allow flee only in PvE
                     handlePlayerAction(playerId, player.currentBattleId, { type: 'flee' });
                 } else {
                     sendInfo(player.ws, "Cannot flee from this type of battle!");
                 }
             }
             break;
        case 'SWAP_GENMON_BATTLE':
             if (player.inBattle && player.currentBattleId) {
                 handlePlayerAction(playerId, player.currentBattleId, { type: 'swap', teamIndex: data.payload.teamIndex });
             }
             break;

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
    const player = gameState.getPlayer(playerId); // Get player data before removing
    if (!player) return; // Already disconnected

    console.log(`Client disconnected: ${playerId}`);

    // If in battle, handle battle end due to disconnect
    if (player.inBattle && player.currentBattleId) {
        handlePlayerDisconnectBattle(playerId); // Let battle logic handle ending
    }

    // Remove player from central state
    gameState.removePlayer(playerId);

    // Broadcast player leave
    broadcast(wss, gameState.getAllPlayers(), { // Pass wss and current players
        type: 'PLAYER_LEAVE',
        payload: { playerId: playerId }
    });
}


// --- Start Server ---
server.listen(PORT, () => {
    console.log(`HTTP server listening on http://localhost:${PORT}`);
});