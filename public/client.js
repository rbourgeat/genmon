const arenaMap = document.getElementById('arena-map');
const connectionStatus = document.getElementById('connection-status');
const playerInfo = document.getElementById('player-info');
const playerGenmonName = document.getElementById('player-genmon-name');
const playerHp = document.getElementById('player-hp');
const playerMaxHp = document.getElementById('player-max-hp');
const playerHpBar = document.getElementById('player-hp-bar');

const battleInterface = document.getElementById('battle-interface');
const opponentInfo = document.getElementById('opponent-info');
const opponentGenmonName = document.getElementById('opponent-genmon-name');
const opponentHp = document.getElementById('opponent-hp');
const opponentMaxHp = document.getElementById('opponent-max-hp');
const opponentHpBar = document.getElementById('opponent-hp-bar');
const battleTurnIndicator = document.getElementById('battle-turn-indicator');
const moveButtonsContainer = document.getElementById('move-buttons');
const battleLog = document.getElementById('battle-log');
const startBattleButton = document.getElementById('start-battle-button');


let ws;
let playerId = null;
let players = {}; // Store other players' data { id: { element, x, y, ... } }
let arenaWidth = 10;
let arenaHeight = 10;
let cellSize = 40; // Should match CSS '.grid-cell' width/height
let myGenmon = null;
let inBattle = false;
let battleData = {}; // Store current battle state


// --- WebSocket Connection ---
function connectWebSocket() {
    // Use window.location.host to dynamically determine the server address
    // Use 'ws://' for http and 'wss://' for https
    const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const wsUrl = `${wsProtocol}${window.location.host}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('WebSocket connection established');
        connectionStatus.textContent = 'Connected';
        connectionStatus.className = 'connected';
    };

    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            // console.log('Message from server:', message); // Debugging
            handleServerMessage(message);
        } catch (error) {
            console.error('Failed to parse message or handle:', error);
        }
    };

    ws.onclose = () => {
        console.log('WebSocket connection closed');
        connectionStatus.textContent = 'Disconnected. Attempting to reconnect...';
        connectionStatus.className = 'disconnected';
        // Simple reconnect logic
        setTimeout(connectWebSocket, 5000);
        // Reset game state on disconnect
        resetGameState();
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        connectionStatus.textContent = 'Connection Error';
        connectionStatus.className = 'disconnected';
        // Consider closing and triggering reconnect here too
        ws.close();
    };
}

function sendMessage(type, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, payload }));
    } else {
        console.error("WebSocket is not connected.");
    }
}

// --- Message Handling ---
function handleServerMessage(message) {
    switch (message.type) {
        case 'INIT':
            initializeGame(message.payload);
            break;
        case 'PLAYER_JOIN':
            addPlayer(message.payload.player);
            break;
        case 'PLAYER_LEAVE':
            removePlayer(message.payload.playerId);
            break;
        case 'PLAYER_MOVE':
            updatePlayerPosition(message.payload.playerId, message.payload.x, message.payload.y);
            break;
         case 'PLAYER_IN_BATTLE':
             updatePlayersInBattle(message.payload.playerIds, true);
             break;
         case 'PLAYER_BATTLE_END':
             updatePlayersInBattle(message.payload.playerIds, false);
             break;
        case 'BATTLE_START':
             startBattleUI(message.payload);
             break;
         case 'BATTLE_UPDATE':
             updateBattleUI(message.payload);
             break;
         case 'REQUEST_MOVE':
             handleRequestMove(message.payload);
             break;
         case 'BATTLE_END':
             endBattleUI(message.payload);
             break;
         case 'INFO': // General info messages from server
             addLogMessage(message.payload.message, 'info');
             break;
        // Add other message handlers
    }
}

// --- Game Initialization and State Management ---
function initializeGame(payload) {
    playerId = payload.playerId;
    arenaWidth = payload.arenaWidth;
    arenaHeight = payload.arenaHeight;
    myGenmon = payload.yourGenmon; // Store full data for own genmon
    players = {}; // Clear existing players

    console.log(`Initialized with ID: ${playerId}`);
    console.log("My Genmon:", myGenmon);

    // Update player info panel
    updatePlayerInfoPanel(myGenmon, payload.yourCurrentHp);


    // Create arena grid
    createArenaGrid(arenaWidth, arenaHeight);

    // Add initial players (including self)
    for (const id in payload.players) {
        addPlayer(payload.players[id]);
    }

     // Set initial state for battle button etc.
     inBattle = false;
     battleInterface.style.display = 'none';
     startBattleButton.style.display = 'block';
     startBattleButton.disabled = false;

}

function resetGameState() {
    playerId = null;
    players = {};
    myGenmon = null;
    inBattle = false;
    battleData = {};
    arenaMap.innerHTML = ''; // Clear map
    playerGenmonName.textContent = '-';
    playerHp.textContent = '-';
    playerMaxHp.textContent = '-';
    updateHpBar(playerHpBar, 0, 1); // Reset HP bar
    battleInterface.style.display = 'none';
    battleLog.innerHTML = '';
    moveButtonsContainer.innerHTML = '';
    startBattleButton.disabled = true;
    startBattleButton.style.display = 'block';
     Object.values(players).forEach(p => p.element?.remove()); // Clean up DOM elements just in case
     players = {};

}

// --- Arena and Player Rendering ---
function createArenaGrid(width, height) {
    arenaMap.innerHTML = ''; // Clear previous grid
    arenaMap.style.gridTemplateColumns = `repeat(${width}, ${cellSize}px)`;
    arenaMap.style.gridTemplateRows = `repeat(${height}, ${cellSize}px)`;
    arenaMap.style.width = `${width * cellSize}px`;
    arenaMap.style.height = `${height * cellSize}px`;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const cell = document.createElement('div');
            cell.classList.add('grid-cell');
            // cell.dataset.x = x; // Optional: for click listeners
            // cell.dataset.y = y;
            arenaMap.appendChild(cell);
        }
    }
}

function addPlayer(playerData) {
    if (playerData.id === playerId && !players[playerId]) {
        // It's me! Update my info if needed (handled by INIT usually)
        // Create a marker for myself too, so I appear on the map
         console.log("Adding self to map:", playerData);
    } else if (playerData.id !== playerId && !players[playerData.id]) {
         console.log("Adding other player:", playerData);
    } else if (players[playerData.id]) {
         console.log("Updating existing player:", playerData);
         // If player already exists, just update position/state, don't recreate element
         updatePlayerPosition(playerData.id, playerData.x, playerData.y);
         updatePlayerInBattleStatus(playerData.id, playerData.inBattle);
         return; // Exit early
    } else {
        return; // Should not happen if logic is correct
    }


    const playerElement = document.createElement('div');
    playerElement.classList.add('player-marker');
    playerElement.id = `player-${playerData.id}`;
    playerElement.style.left = `${playerData.x * cellSize}px`;
    playerElement.style.top = `${playerData.y * cellSize}px`;
     // Use sprite if available
    if(playerData.sprite) {
         const img = document.createElement('img');
         img.src = playerData.sprite;
         img.alt = playerData.genmonName;
         img.onerror = () => { // Fallback if image fails to load
              playerElement.textContent = playerData.genmonName ? playerData.genmonName.substring(0,1) : '?';
              playerElement.style.backgroundColor = stringToColor(playerData.id); // Assign color based on ID
         };
         playerElement.appendChild(img);
    } else {
         playerElement.textContent = playerData.genmonName ? playerData.genmonName.substring(0,1) : '?'; // Display first letter
         playerElement.style.backgroundColor = stringToColor(playerData.id); // Assign color based on ID
    }


    arenaMap.appendChild(playerElement);
    players[playerData.id] = {
        ...playerData, // Store received data
        element: playerElement
    };

    updatePlayerInBattleStatus(playerData.id, playerData.inBattle);


}

function removePlayer(id) {
     if (players[id]) {
        console.log(`Removing player ${id}`);
        players[id].element?.remove(); // Remove element from DOM
        delete players[id]; // Remove from our state object
    }
}

function updatePlayerPosition(id, x, y) {
    if (players[id] && players[id].element) {
        players[id].x = x;
        players[id].y = y;
        players[id].element.style.left = `${x * cellSize}px`;
        players[id].element.style.top = `${y * cellSize}px`;
    } else if (id === playerId && !players[id]) {
         // Player data might not be in 'players' object if it's self, handle this case
         // This might require adding self to the 'players' object during INIT
         // For now, we assume self is added via addPlayer during INIT
         console.warn("Trying to move self, but self not found in players object.");
     }
}

function updatePlayersInBattle(playerIds, isInBattle) {
    playerIds.forEach(id => {
       updatePlayerInBattleStatus(id, isInBattle);
    });
}

function updatePlayerInBattleStatus(id, isInBattle) {
     const player = players[id];
    if (player && player.element) {
        player.inBattle = isInBattle;
        if (isInBattle) {
            player.element.classList.add('in-battle');
        } else {
            player.element.classList.remove('in-battle');
        }
    }
     if (id === playerId) {
          // Update UI elements related to self being in battle
          inBattle = isInBattle; // Update global flag
          startBattleButton.style.display = isInBattle ? 'none' : 'block';
          if (!isInBattle) {
              battleInterface.style.display = 'none'; // Hide battle UI if battle ends
          }
     }
}


// --- Player Movement Input ---
document.addEventListener('keydown', (event) => {
    if (inBattle) return; // Disable map movement during battle

    let direction = null;
    switch (event.key) {
        case 'ArrowUp': case 'w': direction = 'up'; break;
        case 'ArrowDown': case 's': direction = 'down'; break;
        case 'ArrowLeft': case 'a': direction = 'left'; break;
        case 'ArrowRight': case 'd': direction = 'right'; break;
        default: return; // Ignore other keys
    }
    event.preventDefault(); // Prevent scrolling
    sendMessage('MOVE', { direction });
});

// --- Battle UI ---

startBattleButton.addEventListener('click', () => {
     if (!inBattle) {
          console.log("Attempting to start battle...");
          sendMessage('START_BATTLE', {}); // Server will check proximity
          startBattleButton.disabled = true; // Prevent spamming
          startBattleButton.textContent = "Searching...";
          // Re-enable button after a timeout if no battle starts? Or server sends failure message.
          setTimeout(() => {
               if (!inBattle) { // Only re-enable if not in battle
                    startBattleButton.disabled = false;
                    startBattleButton.textContent = "Look for Battle";
               }
          }, 3000); // Example timeout
     }
});


function startBattleUI(payload) {
    console.log("Battle starting:", payload);
    inBattle = true;
    battleData = payload; // Store battle details

    // Determine who is player and who is opponent
    const myInfo = payload.player1.id === playerId ? payload.player1 : payload.player2;
    const opponentInfo = payload.player1.id === playerId ? payload.player2 : payload.player1;

    battleData.myInfo = myInfo;
    battleData.opponentInfo = opponentInfo;

    // Update Player Panel with Battle HP
    updatePlayerInfoPanel(myGenmon, myInfo.currentHp, myInfo.maxHp); // Use battle start HP

    // Update Opponent Panel
    opponentGenmonName.textContent = opponentInfo.name;
    opponentHp.textContent = opponentInfo.currentHp;
    opponentMaxHp.textContent = opponentInfo.maxHp;
    updateHpBar(opponentHpBar, opponentInfo.currentHp, opponentInfo.maxHp);

    // Populate Move Buttons (using own genmon data)
    moveButtonsContainer.innerHTML = ''; // Clear old buttons
     myGenmon.moves.forEach(moveName => {
        const button = document.createElement('button');
        button.textContent = moveName;
        button.onclick = () => {
            if (battleData.myTurn) { // Only allow clicking on my turn
                sendMessage('SELECT_MOVE', { moveName });
                // Disable buttons after sending move
                disableMoveButtons('Waiting for opponent...');
            }
        };
        moveButtonsContainer.appendChild(button);
    });

    // Clear and populate Battle Log
    battleLog.innerHTML = '';
    payload.initialLog.forEach(msg => addLogMessage(msg));

    // Show Battle Interface, hide Start Button
    battleInterface.style.display = 'block';
    startBattleButton.style.display = 'none';
    battleTurnIndicator.textContent = 'Battle Started!';

    // Initial turn state is handled by REQUEST_MOVE message
    disableMoveButtons("Waiting for turn...");
}

function handleRequestMove(payload) {
     if (!inBattle) return; // Ignore if not in battle

     addLogMessage(payload.message, 'turn');
     battleTurnIndicator.textContent = payload.message;

     if (payload.playerId === playerId) {
          battleData.myTurn = true;
          enableMoveButtons("Your Turn! Select a move.");
     } else {
          battleData.myTurn = false;
          disableMoveButtons(`Waiting for ${battleData.opponentInfo.name}...`);
     }
}


function updateBattleUI(payload) {
    if (!inBattle) return;

    console.log("Battle update:", payload);
    addLogMessage(payload.logUpdate);

    // Update HP based on who was the defender
    if (payload.defenderId === playerId) {
        playerHp.textContent = payload.defenderCurrentHp;
        updateHpBar(playerHpBar, payload.defenderCurrentHp, battleData.myInfo.maxHp);
    } else if (payload.defenderId === battleData.opponentInfo.id) {
        opponentHp.textContent = payload.defenderCurrentHp;
        updateHpBar(opponentHpBar, payload.defenderCurrentHp, battleData.opponentInfo.maxHp);
    }

     // Add simple animation indication (e.g., flash the defender)
     const defenderElement = payload.defenderId === playerId ? playerInfo : opponentInfo;
     flashElement(defenderElement);

     // Play attack sound/animation here later
}

function endBattleUI(payload) {
     if (!inBattle) return; // Prevent running if already ended
     console.log("Battle ended:", payload);
     inBattle = false;
     battleData.myTurn = false; // Ensure turns stop

     payload.finalLog.forEach(msg => {
         // Avoid adding duplicate final message if already in log
         const existingMsgs = Array.from(battleLog.querySelectorAll('li')).map(li => li.textContent);
         if (!existingMsgs.includes(msg)) {
              addLogMessage(msg, payload.winnerId === playerId ? 'win' : 'loss');
         }
     });


    const finalMessage = payload.winnerId === playerId
        ? `You won!`
        : `${battleData.opponentInfo.name} won!`;
    battleTurnIndicator.textContent = `Battle Over! ${finalMessage}`;
    disableMoveButtons("Battle Finished");

    // Option: Keep battle interface visible for a moment, then hide
    setTimeout(() => {
         if (!inBattle) { // Check again in case a new battle started instantly
              battleInterface.style.display = 'none';
              startBattleButton.style.display = 'block';
              startBattleButton.disabled = false; // Re-enable button
              startBattleButton.textContent = "Look for Battle";
               // Maybe reset opponent panel?
              opponentGenmonName.textContent = '-';
              opponentHp.textContent = '-';
              opponentMaxHp.textContent = '-';
              updateHpBar(opponentHpBar, 0, 1);
         }
    }, 5000); // Hide after 5 seconds

     // Important: Update the player's HP in the main player panel to reflect post-battle state
     // Server currently doesn't send this, client needs to remember its HP or server needs to send final state.
     // Let's assume client remembers 'playerHp.textContent'
      updatePlayerInfoPanel(myGenmon, parseInt(playerHp.textContent) || 0 ); // Update with current HP displayed

}


function addLogMessage(message, type = 'normal') {
    const li = document.createElement('li');
    li.textContent = message;
    li.classList.add(`log-${type}`); // Add class for potential styling
    battleLog.appendChild(li);
    // Auto-scroll to bottom
    battleLog.parentElement.scrollTop = battleLog.parentElement.scrollHeight;
}

function updatePlayerInfoPanel(genmon, currentHp, maxHp = null) {
     if(!genmon) return;
     playerGenmonName.textContent = genmon.name;
     playerMaxHp.textContent = maxHp !== null ? maxHp : genmon.stats.hp; // Use maxHp if provided (from battle), else default
     playerHp.textContent = Math.max(0, currentHp); // Ensure HP doesn't go below 0
     updateHpBar(playerHpBar, currentHp, parseInt(playerMaxHp.textContent));
 }


function updateHpBar(barElement, current, max) {
    const percentage = max > 0 ? (current / max) * 100 : 0;
    barElement.style.width = `${percentage}%`;
    //barElement.textContent = `${current}/${max}`; // Optional: text inside bar

    // Change color based on HP percentage
    barElement.classList.remove('low', 'medium');
    if (percentage <= 25) {
        barElement.classList.add('low');
    } else if (percentage <= 50) {
        barElement.classList.add('medium');
    }
}

function disableMoveButtons(message) {
    battleTurnIndicator.textContent = message;
    const buttons = moveButtonsContainer.querySelectorAll('button');
    buttons.forEach(button => button.disabled = true);
}

function enableMoveButtons(message) {
    battleTurnIndicator.textContent = message;
    const buttons = moveButtonsContainer.querySelectorAll('button');
    buttons.forEach(button => button.disabled = false);
}

function flashElement(element) {
    if(!element) return;
    element.style.transition = 'outline 0.1s ease-in-out';
    element.style.outline = '3px solid yellow';
    setTimeout(() => {
         element.style.outline = 'none';
    }, 300); // Flash duration
}


// --- Utility Functions ---
function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    let color = '#';
    for (let i = 0; i < 3; i++) {
        const value = (hash >> (i * 8)) & 0xFF;
        color += ('00' + value.toString(16)).substr(-2);
    }
    return color;
}


// --- Initialize ---
connectWebSocket();