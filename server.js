// FILE: ./server.js
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const gameState = require('./game/gameState');
const { generateUniqueId, sendInfo, broadcast } = require('./game/utils');
const { mapData, TILE_OBSTACLE, MAP_WIDTH, MAP_HEIGHT, INITIAL_MONEY, INITIAL_LEVEL } = require('./game/constants');
const { getPublicPlayerData, getPrivatePlayerData, handleSwapGenmonTeam, handleReleaseGenmon } = require('./game/player');
const { handlePlayerMove } = require('./game/map');
// Import from the new battle index file
const battle = require('./game/battle'); // Imports all exported battle functions
const { createGenmonInstance, genmonData } = require('./data/genmonData');

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
    ws.server = wss;

    // Find a valid starting position
    let startX, startY;
    do {
        startX = Math.floor(Math.random() * MAP_WIDTH);
        startY = Math.floor(Math.random() * MAP_HEIGHT);
    } while (mapData[startY] && mapData[startY][startX] === TILE_OBSTACLE); // Added check for mapData[startY]

    // Assign starting Genmon team
    const availableGenmonIds = Object.keys(genmonData);
    let startingTeam = [];
    if (availableGenmonIds.length > 0) {
        const startingGenmonId = availableGenmonIds[Math.floor(Math.random() * availableGenmonIds.length)];
        const startingGenmonInstance = createGenmonInstance(startingGenmonId, INITIAL_LEVEL);
        if (startingGenmonInstance) {
            startingTeam.push(startingGenmonInstance);
        }
    }
    if (startingTeam.length === 0) {
         console.warn("Could not create starting Genmon. Player will start with an empty team.");
    }

    // Store player data
    const playerData = {
        ws: ws,
        id: playerId,
        x: startX,
        y: startY,
        direction: 'down',
        money: INITIAL_MONEY,
        team: startingTeam,
        activeGenmonIndex: 0,
        inBattle: false,
        currentBattleId: null
    };
    gameState.addPlayer(playerId, playerData);

    // Send initial state
    const initialPayload = {
        playerId: playerId,
        players: getPublicPlayerData(), // Send simplified data of others
        mapData: mapData,
        yourPlayer: getPrivatePlayerData(playerId) // Send detailed own data
    };
     // Validate payload before sending
     if (initialPayload.yourPlayer) {
        ws.send(JSON.stringify({ type: 'INIT', payload: initialPayload }));
     } else {
          console.error(`Failed to get private player data for ${playerId} during INIT.`);
          // Handle error - maybe close connection or send error message
          ws.close(1011, "Server error initializing player data.");
          gameState.removePlayer(playerId); // Clean up state
          return; // Stop further processing for this connection
     }


    // Broadcast new player connection
    const publicJoinData = getPublicPlayerData(playerId);
    if (publicJoinData) {
         broadcast(wss, gameState.getAllPlayers(), {
             type: 'PLAYER_JOIN',
             payload: { player: publicJoinData }
         }, ws);
    }

    // Handle messages
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleClientMessage(playerId, data);
        } catch (error) {
            console.error(`Failed to parse message or handle request from ${playerId}:`, message, error);
            sendInfo(ws, `Server error processing your request: ${error.message || 'Unknown error'}`);
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
        console.log(`Message received from disconnected or unknown player ${playerId}: ${data?.type}`);
        return;
    }

    // Check if player is in a battle
    const currentBattle = player.inBattle && player.currentBattleId ? gameState.getBattle(player.currentBattleId) : null;

    // Actions allowed only IN battle (and battle exists)
    const battleActions = ['SELECT_MOVE', 'ATTEMPT_CATCH', 'SWAP_GENMON_BATTLE', 'FLEE_BATTLE'];
    // Actions allowed only OUTSIDE battle
    const nonBattleActions = ['MOVE', 'INITIATE_DUEL', 'RESPOND_DUEL', 'SWAP_GENMON_TEAM', 'RELEASE_GENMON'];

    // Basic checks
    if (player.inBattle && nonBattleActions.includes(data.type)) {
        sendInfo(player.ws, `Action ${data.type} not allowed during battle.`);
        console.log(`Player ${playerId} attempted non-battle action ${data.type} while in battle ${player.currentBattleId}.`);
        return;
    }
    if (!player.inBattle && battleActions.includes(data.type)) {
        sendInfo(player.ws, `Action ${data.type} only allowed during battle.`);
        console.log(`Player ${playerId} attempted battle action ${data.type} while not in battle.`);
        return;
    }

    // Delegate to appropriate handler
    switch (data.type) {
        // --- Map Actions ---
        case 'MOVE':
            handlePlayerMove(playerId, data.payload?.direction);
            break;

        // --- Team Management (Outside Battle) ---
        case 'SWAP_GENMON_TEAM':
             handleSwapGenmonTeam(playerId, data.payload?.teamIndex);
             break;
        case 'RELEASE_GENMON':
             handleReleaseGenmon(playerId, data.payload?.teamIndex);
             break;

        // --- Duel Actions ---
        case 'INITIATE_DUEL':
            battle.handleInitiateDuel(playerId, data.payload?.targetId);
            break;
        case 'RESPOND_DUEL':
            battle.handleRespondDuel(playerId, data.payload?.challengerId, data.payload?.accepted);
            break;

        // --- Battle Actions (Forward to battle module) ---
        case 'SELECT_MOVE':
        case 'ATTEMPT_CATCH':
        case 'FLEE_BATTLE':
        case 'SWAP_GENMON_BATTLE':
             if (player.inBattle && player.currentBattleId && currentBattle) {
                // Construct the action object based on type
                let actionPayload;
                switch (data.type) {
                    case 'SELECT_MOVE':
                        actionPayload = { type: 'move', moveName: data.payload?.moveName };
                        break;
                    case 'ATTEMPT_CATCH':
                         if (currentBattle.type !== 'PvE') return sendInfo(player.ws, "Cannot catch in this type of battle!");
                         actionPayload = { type: 'catch' };
                         break;
                    case 'FLEE_BATTLE':
                         if (currentBattle.type !== 'PvE') return sendInfo(player.ws, "Cannot flee from this type of battle!");
                         actionPayload = { type: 'flee' };
                         break;
                    case 'SWAP_GENMON_BATTLE':
                         actionPayload = { type: 'swap', teamIndex: data.payload?.teamIndex };
                         break;
                    default: // Should not happen
                         console.error("Unhandled battle action type in switch:", data.type);
                         return;
                }
                // Validate action payload before sending
                if (actionPayload && (actionPayload.type === 'move' ? actionPayload.moveName : true) && (actionPayload.type === 'swap' ? typeof actionPayload.teamIndex === 'number' : true)) {
                    battle.handlePlayerAction(playerId, player.currentBattleId, actionPayload);
                } else {
                     console.warn(`Invalid payload for battle action ${data.type} from ${playerId}:`, data.payload);
                     sendInfo(player.ws, `Invalid payload for action ${data.type}.`);
                     // Potentially re-request action if validation fails badly
                     // battle.requestPlayerAction(playerId, player.currentBattleId);
                }
             }
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
    if (!player) {
         console.log(`Disconnect handler called for already removed player: ${playerId}`);
         return; // Already disconnected or never fully connected
    }

    console.log(`Client disconnected: ${playerId}`);

    // If in battle, handle battle end due to disconnect using the battle module function
    if (player.inBattle && player.currentBattleId) {
        console.log(`Player ${playerId} disconnected during battle ${player.currentBattleId}. Handling battle end.`);
        battle.handlePlayerDisconnectBattle(playerId); // Let battle logic handle ending cleanly
    }

    // Get server instance before removing player (if needed for broadcast)
    const wss = player.ws?.server;

    // Remove player from central state
    gameState.removePlayer(playerId);

    // Broadcast player leave if wss is available
    if (wss) {
        broadcast(wss, gameState.getAllPlayers(), {
            type: 'PLAYER_LEAVE',
            payload: { playerId: playerId }
        });
    } else {
        console.warn(`Could not broadcast PLAYER_LEAVE for ${playerId}, wss not found.`);
    }
}


// --- Start Server ---
server.listen(PORT, () => {
    console.log(`HTTP server listening on http://localhost:${PORT}`);
});