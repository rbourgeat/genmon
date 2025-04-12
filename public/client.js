// Get references to existing and new elements
const arenaMap = document.getElementById('arena-map'); // Rename? mapContainer?
const connectionStatus = document.getElementById('connection-status');
const playerInfoPanel = document.getElementById('player-info-panel'); // Contains team + active genmon info
const teamList = document.getElementById('team-list'); // New UL element for team
const activeGenmonInfo = document.getElementById('active-genmon-info'); // Div for current active genmon details
const activeGenmonName = document.getElementById('active-genmon-name');
const activeGenmonHp = document.getElementById('active-genmon-hp');
const activeGenmonMaxHp = document.getElementById('active-genmon-max-hp');
const activeGenmonHpBar = document.getElementById('active-genmon-hp-bar');

const battleInterface = document.getElementById('battle-interface');
const battlePlayerInfo = document.getElementById('battle-player-info'); // Player side in battle
const battlePlayerGenmonName = document.getElementById('battle-player-genmon-name');
const battlePlayerHp = document.getElementById('battle-player-hp');
const battlePlayerMaxHp = document.getElementById('battle-player-max-hp');
const battlePlayerHpBar = document.getElementById('battle-player-hp-bar');

const battleOpponentInfo = document.getElementById('battle-opponent-info'); // Opponent side in battle
const battleOpponentName = document.getElementById('battle-opponent-name'); // Wild name or Player ID
const battleOpponentGenmonName = document.getElementById('battle-opponent-genmon-name');
const battleOpponentHp = document.getElementById('battle-opponent-hp');
const battleOpponentMaxHp = document.getElementById('battle-opponent-max-hp');
const battleOpponentHpBar = document.getElementById('battle-opponent-hp-bar');

const battleTurnIndicator = document.getElementById('battle-turn-indicator');
const moveButtonsContainer = document.getElementById('move-buttons');
const actionButtonsContainer = document.getElementById('action-buttons'); // New container for Fight, Catch, Swap, Flee
const battleLog = document.getElementById('battle-log');

// Buttons (Add Catch, Swap, Flee to HTML or create dynamically)
const fightButton = document.getElementById('fight-button');
const catchButton = document.getElementById('catch-button');
const swapButton = document.getElementById('swap-button');
const fleeButton = document.getElementById('flee-button');

const duelPrompt = document.getElementById('duel-prompt'); // New element for duel requests
const duelRequesterName = document.getElementById('duel-requester-name');
const acceptDuelButton = document.getElementById('accept-duel-button');
const declineDuelButton = document.getElementById('decline-duel-button');


// --- Client State ---
let ws;
let playerId = null;
let players = {}; // Store other players' data { id: { element, x, y, direction, sprite, ... } }
let mapData = [];
let mapWidth = 0;
let mapHeight = 0;
let cellSize = 40; // Should match CSS '.tile' width/height

let myTeam = [];
let myActiveGenmonIndex = 0;
let myDirection = 'down';
let inBattle = false;
let currentBattle = { // Store current battle state details
    id: null,
    type: null, // 'PvE', 'PvP'
    myGenmon: null,
    opponentGenmon: null, // Instance for wild, or data obj for player
    opponentPlayerId: null, // for PvP
    myTurn: false,
    waitingForAction: false, // True when REQUEST_ACTION is received for me
};
let pendingDuelChallengerId = null;


// --- WebSocket Connection --- (Largely unchanged)
function connectWebSocket() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const wsUrl = `${wsProtocol}${window.location.host}`;
    ws = new WebSocket(wsUrl);
    ws.onopen = () => { console.log('WebSocket connected'); updateStatus('Connected', true); };
    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            // console.log('Message from server:', message); // Debugging
            handleServerMessage(message);
        } catch (error) { console.error('Failed to parse message or handle:', error); }
    };
    ws.onclose = () => { console.log('WebSocket closed'); updateStatus('Disconnected. Reconnecting...', false); resetGameState(); setTimeout(connectWebSocket, 5000); };
    ws.onerror = (error) => { console.error('WebSocket error:', error); updateStatus('Connection Error', false); ws.close(); };
}

function sendMessage(type, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, payload }));
    } else { console.error("WebSocket is not connected."); }
}

function updateStatus(text, connected) {
    connectionStatus.textContent = text;
    connectionStatus.className = connected ? 'connected' : 'disconnected';
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
        case 'PLAYER_UPDATE': // Consolidated update message
            updatePlayer(message.payload.player);
            break;
        case 'PLAYER_IN_BATTLE':
             updatePlayersInBattle(message.payload.playerIds, true);
             break;
        case 'PLAYER_BATTLE_END':
             updatePlayersInBattle(message.payload.playerIds, false);
             break;

        // Battle Flow (Unified PvE/PvP where possible)
        case 'WILD_BATTLE_START':
             startWildBattleUI(message.payload);
             break;
        case 'DUEL_START':
             startDuelUI(message.payload);
             break;
        case 'REQUEST_ACTION': // Server asks for player input
             handleRequestAction(message.payload);
             break;
         case 'BATTLE_UPDATE': // Turn results, HP changes, etc.
             updateBattleUI(message.payload);
             break;
         case 'BATTLE_END':
             endBattleUI(message.payload);
             break;
         case 'REQUEST_SWITCH': // Player must switch fainted Genmon
             handleRequestSwitch(message.payload);
             break;

         // Team Management
         case 'TEAM_UPDATE':
             updateTeamData(message.payload.team, message.payload.activeGenmonIndex);
             break;

        // Duels
        case 'DUEL_REQUEST':
            showDuelRequest(message.payload.challengerId, message.payload.challengerName);
            break;

        // General Info/Errors
        case 'INFO':
            showInfoMessage(message.payload.message); // Display temporary message
            break;
        default:
             console.log("Unhandled message type:", message.type);
             break;
    }
}

// --- Game Initialization and State ---
function initializeGame(payload) {
    playerId = payload.playerId;
    mapData = payload.mapData;
    mapHeight = mapData.length;
    mapWidth = mapData[0].length;
    players = {}; // Clear existing players

    console.log(`Initialized with ID: ${playerId}`);

    updateTeamData(payload.yourPlayer.team, payload.yourPlayer.activeGenmonIndex);
    myDirection = payload.yourPlayer.direction;

    // Render Map
    renderMap();

    // Add initial players (including self)
    for (const id in payload.players) {
        addPlayer(payload.players[id]);
    }

    // Initial UI state
    inBattle = false;
    battleInterface.style.display = 'none';
    playerInfoPanel.style.display = 'block'; // Show player info/team
    hideDuelRequest(); // Ensure duel prompt is hidden
}

function resetGameState() {
    playerId = null;
    players = {};
    myTeam = [];
    myActiveGenmonIndex = 0;
    mapData = [];
    inBattle = false;
    currentBattle = { id: null, type: null, myGenmon: null, opponentGenmon: null, myTurn: false, waitingForAction: false };
    arenaMap.innerHTML = '';
    teamList.innerHTML = '';
    updateActiveGenmonInfo(null); // Clear active info
    battleInterface.style.display = 'none';
    battleLog.innerHTML = '';
    moveButtonsContainer.innerHTML = '';
    actionButtonsContainer.style.display = 'none'; // Hide action buttons too
    updateStatus('Disconnected', false);
    hideDuelRequest();
    Object.values(players).forEach(p => p.element?.remove());
    players = {};
}

// --- Map and Player Rendering ---
function renderMap() {
    arenaMap.innerHTML = ''; // Clear previous map
    arenaMap.style.gridTemplateColumns = `repeat(${mapWidth}, ${cellSize}px)`;
    arenaMap.style.gridTemplateRows = `repeat(${mapHeight}, ${cellSize}px)`;
    arenaMap.style.width = `${mapWidth * cellSize}px`;
    arenaMap.style.height = `${mapHeight * cellSize}px`;

    for (let y = 0; y < mapHeight; y++) {
        for (let x = 0; x < mapWidth; x++) {
            const cell = document.createElement('div');
            cell.classList.add('tile');
            const tileType = mapData[y][x];
            cell.classList.add(
                tileType === 0 ? 'tile-path' :
                tileType === 1 ? 'tile-grass' :
                tileType === 2 ? 'tile-obstacle' : 'tile-unknown'
            );
             // Add coordinates for debugging/interaction later
            cell.dataset.x = x;
            cell.dataset.y = y;
             // Basic click listener for initiating duels
             cell.onclick = (e) => handleMapClick(e.target);
            arenaMap.appendChild(cell);
        }
    }
}

function addPlayer(playerData) {
    if (players[playerData.id]) { // Already exists, update instead
        updatePlayer(playerData);
        return;
    }
    console.log("Adding player:", playerData);

    const playerElement = document.createElement('div');
    playerElement.classList.add('player-marker');
    playerElement.id = `player-${playerData.id}`;

    const img = document.createElement('img');
    // Use placeholder initially, updatePlayer will set correct sprite/direction
    img.src = playerData.sprite || '/assets/default_player.png'; // Default/fallback
    img.alt = playerData.genmonName || playerData.id;
    img.onerror = () => { // Fallback if image fails
         playerElement.textContent = '?'; // Simple fallback text
         playerElement.style.backgroundColor = stringToColor(playerData.id);
     };
     playerElement.appendChild(img);

    arenaMap.appendChild(playerElement);

    players[playerData.id] = {
        ...playerData, // Store received data
        element: playerElement,
        imgElement: img // Store image element ref for easier sprite change
    };

    // Set initial position, direction, and battle status
    updatePlayer(playerData);
}

function removePlayer(id) {
     if (players[id]) {
        console.log(`Removing player ${id}`);
        players[id].element?.remove();
        delete players[id];
    }
}

// Consolidated player update function
function updatePlayer(playerData) {
    const player = players[playerData.id];
    if (!player) { // Player might not exist yet (e.g., self update before element created)
        if (playerData.id === playerId) {
             // Update self state if needed (handled by TEAM_UPDATE mostly)
             myDirection = playerData.direction;
        }
         // If player doesn't exist, try adding them (covers join race conditions)
         addPlayer(playerData);
         return; // addPlayer calls updatePlayer again recursively, exit here
    }

    // Update state
    player.x = playerData.x;
    player.y = playerData.y;
    player.direction = playerData.direction;
    player.inBattle = playerData.inBattle;
    player.sprite = playerData.sprite; // Update sprite URL
    player.genmonName = playerData.genmonName;

    // Update DOM Element Position
    player.element.style.left = `${player.x * cellSize}px`;
    player.element.style.top = `${player.y * cellSize}px`;

    // Update DOM Element Appearance (Direction & Battle Status)
    // Basic direction handling: Use CSS classes or change img src if directional sprites exist
    // For now, just update the sprite if it changed (e.g., active Genmon swap)
    if (player.imgElement.src !== player.sprite && player.sprite) {
         player.imgElement.src = player.sprite;
         player.imgElement.alt = player.genmonName || player.id;
    }
     // TODO: Add classes for direction like player.element.classList.add(`dir-${player.direction}`);
     // and remove old direction classes

    // Update battle status class
    if (player.inBattle) {
        player.element.classList.add('in-battle');
    } else {
        player.element.classList.remove('in-battle');
    }
}

function updatePlayersInBattle(playerIds, isInBattle) {
    playerIds.forEach(id => {
       const player = players[id];
       if (player) {
            player.inBattle = isInBattle;
            if (player.element) {
                 if (isInBattle) {
                    player.element.classList.add('in-battle');
                 } else {
                    player.element.classList.remove('in-battle');
                 }
            }
       }
       // Update self state/UI if affected
       if (id === playerId) {
            inBattle = isInBattle;
            // Show/hide appropriate UI panels
            playerInfoPanel.style.display = isInBattle ? 'none' : 'block';
            if (!isInBattle) {
                battleInterface.style.display = 'none'; // Ensure battle UI is hidden if we exit battle
            }
       }
    });
}


// --- Team Management UI ---
function updateTeamData(team, activeIndex) {
    myTeam = team || []; // Ensure it's an array
    myActiveGenmonIndex = activeIndex;

    // Update the team list display
    teamList.innerHTML = ''; // Clear previous list
    myTeam.forEach((genmon, index) => {
        const li = document.createElement('li');
        li.classList.add('team-member');
        if (index === myActiveGenmonIndex) {
            li.classList.add('active');
        }
        if (genmon.currentHp <= 0) {
            li.classList.add('fainted');
        }

        const nameSpan = document.createElement('span');
        nameSpan.textContent = `${genmon.name} (Lvl?)`; // Add level later

        const hpSpan = document.createElement('span');
        hpSpan.textContent = `HP: ${genmon.currentHp}/${genmon.stats.hp}`;

        li.appendChild(nameSpan);
        li.appendChild(hpSpan);

        // Add buttons for swap/release (only if not fainted/not last genmon)
        if (!inBattle) { // Only allow outside battle
            const buttonContainer = document.createElement('div');
            buttonContainer.classList.add('team-buttons');

             // Swap Button
            if (index !== myActiveGenmonIndex && genmon.currentHp > 0) {
                 const swapBtn = document.createElement('button');
                 swapBtn.textContent = 'Set Active';
                 swapBtn.onclick = (e) => {
                     e.stopPropagation(); // Prevent li click if needed
                     sendMessage('SWAP_GENMON_TEAM', { teamIndex: index });
                 };
                 buttonContainer.appendChild(swapBtn);
            }

             // Release Button
             if (myTeam.length > 1) { // Cannot release last one
                 const releaseBtn = document.createElement('button');
                 releaseBtn.textContent = 'Release';
                 releaseBtn.classList.add('release-button');
                 releaseBtn.onclick = (e) => {
                     e.stopPropagation();
                     if (confirm(`Are you sure you want to release ${genmon.name}?`)) {
                         sendMessage('RELEASE_GENMON', { teamIndex: index });
                     }
                 };
                 buttonContainer.appendChild(releaseBtn);
             }
             li.appendChild(buttonContainer);
        }

        teamList.appendChild(li);
    });

    // Update the separate "Active Genmon" info panel
    const activeGenmon = myTeam[myActiveGenmonIndex];
    updateActiveGenmonInfo(activeGenmon);
}

function updateActiveGenmonInfo(genmon) {
     if (genmon) {
         activeGenmonName.textContent = genmon.name;
         activeGenmonHp.textContent = genmon.currentHp;
         activeGenmonMaxHp.textContent = genmon.stats.hp;
         updateHpBar(activeGenmonHpBar, genmon.currentHp, genmon.stats.hp);
         activeGenmonInfo.style.display = 'block';
     } else {
         activeGenmonName.textContent = '-';
         activeGenmonHp.textContent = '-';
         activeGenmonMaxHp.textContent = '-';
         updateHpBar(activeGenmonHpBar, 0, 1);
         activeGenmonInfo.style.display = 'none';
     }
 }


// --- Player Movement & Interaction Input ---
document.addEventListener('keydown', (event) => {
    if (inBattle || duelPrompt.style.display !== 'none') return; // No map movement during battle or duel prompt

    let direction = null;
    switch (event.key) {
        case 'ArrowUp': case 'w': direction = 'up'; break;
        case 'ArrowDown': case 's': direction = 'down'; break;
        case 'ArrowLeft': case 'a': direction = 'left'; break;
        case 'ArrowRight': case 'd': direction = 'right'; break;
        default: return;
    }
    event.preventDefault();
    sendMessage('MOVE', { direction });
});

// Handle clicking on the map (e.g., to challenge players)
function handleMapClick(targetElement) {
    if (inBattle || !targetElement || !targetElement.dataset) return;

    const targetX = parseInt(targetElement.dataset.x);
    const targetY = parseInt(targetElement.dataset.y);

    // Find if a player is on this tile
    let targetPlayerId = null;
    for (const id in players) {
        if (players[id].x === targetX && players[id].y === targetY && id !== playerId) {
            targetPlayerId = id;
            break;
        }
    }

    if (targetPlayerId) {
        // Initiate duel if player clicked
        if (confirm(`Challenge player ${targetPlayerId} to a duel?`)) {
            console.log(`Attempting to initiate duel with ${targetPlayerId}`);
            sendMessage('INITIATE_DUEL', { targetId: targetPlayerId });
        }
    } else {
        // Clicked empty tile - maybe pathfinding later?
        console.log(`Clicked on empty tile (${targetX}, ${targetY})`);
    }
}


// --- Battle UI ---

function startWildBattleUI(payload) {
    console.log("Wild Battle starting:", payload);
    setupBattleUI('PvE', payload.playerGenmon, payload.opponentGenmon, null, payload.battleId, payload.initialLog);

    // PvE specific setup
    battleOpponentName.textContent = "Wild"; // Just "Wild" for opponent name
    catchButton.style.display = 'inline-block'; // Show Catch button
    fleeButton.style.display = 'inline-block'; // Show Flee button (PvE only for now)
}

function startDuelUI(payload) {
    console.log("Duel starting:", payload);
    const myPlayerId = playerId;
    const myInfo = payload.player1.id === myPlayerId ? payload.player1 : payload.player2;
    const opponentInfo = payload.player1.id === myPlayerId ? payload.player2 : payload.player1;

    setupBattleUI('PvP', myInfo.genmon, opponentInfo.genmon, opponentInfo.id, payload.battleId, payload.initialLog);

    // PvP specific setup
    battleOpponentName.textContent = opponentInfo.id; // Show opponent Player ID
    catchButton.style.display = 'none'; // Hide Catch button
    fleeButton.style.display = 'none'; // Hide Flee button in PvP
}

function setupBattleUI(type, myGenmon, opponentGenmon, opponentPlayerId, battleId, initialLog) {
    inBattle = true;
    currentBattle = {
        id: battleId,
        type: type,
        myGenmon: myGenmon,
        opponentGenmon: opponentGenmon,
        opponentPlayerId: opponentPlayerId,
        myTurn: false, // Server will tell us whose turn it is via REQUEST_ACTION
        waitingForAction: false,
    };

    playerInfoPanel.style.display = 'none'; // Hide map info/team list
    battleInterface.style.display = 'block'; // Show battle panel

    // Populate Player Battle Info
    updateBattleParticipantUI(battlePlayerGenmonName, battlePlayerHp, battlePlayerMaxHp, battlePlayerHpBar, myGenmon);

    // Populate Opponent Battle Info
     updateBattleParticipantUI(battleOpponentGenmonName, battleOpponentHp, battleOpponentMaxHp, battleOpponentHpBar, opponentGenmon);

    // Clear and populate Battle Log
    battleLog.innerHTML = '';
    initialLog.forEach(msg => addLogMessage(msg));

    // Reset buttons state
    showActionButtons(); // Show Fight/Catch/Swap/Flee
    hideMoveButtons(); // Hide specific move buttons initially

    battleTurnIndicator.textContent = 'Battle Started!';
}

// Update UI for one side of the battle
function updateBattleParticipantUI(nameEl, hpEl, maxHpEl, hpBarEl, genmon) {
    if (genmon) {
        nameEl.textContent = genmon.name;
        hpEl.textContent = genmon.currentHp;
        maxHpEl.textContent = genmon.stats.hp;
        updateHpBar(hpBarEl, genmon.currentHp, genmon.stats.hp);
    } else { // Clear if no genmon data (shouldn't happen in active battle)
        nameEl.textContent = '-';
        hpEl.textContent = '-';
        maxHpEl.textContent = '-';
        updateHpBar(hpBarEl, 0, 1);
    }
}


function handleRequestAction(payload) {
     if (!inBattle || payload.battleId !== currentBattle.id) return;

     const isMyTurn = payload.playerId === playerId;
     currentBattle.myTurn = isMyTurn;
     currentBattle.waitingForAction = isMyTurn;

     const turnMessage = isMyTurn ? "Your turn! Choose an action." : `Waiting for ${currentBattle.opponentGenmon?.name || currentBattle.opponentPlayerId}...`;
     battleTurnIndicator.textContent = turnMessage;
     addLogMessage(turnMessage, 'turn');

     if (isMyTurn) {
         showActionButtons(); // Show Fight/Catch etc.
         hideMoveButtons(); // Ensure moves are hidden until Fight is chosen
     } else {
         hideActionButtons(); // Disable actions if not my turn
         hideMoveButtons();
     }
}

function handleRequestSwitch(payload) {
    if (!inBattle || payload.battleId !== currentBattle.id) return;

     addLogMessage(payload.reason + " Choose another Genmon.", 'info');
     battleTurnIndicator.textContent = "Choose your next Genmon!";
     currentBattle.myTurn = true; // It's our turn to *switch*
     currentBattle.waitingForAction = true;

     hideActionButtons(); // Can't Fight/Catch/Flee now
     showSwapButtons(); // Show team list to pick replacement (modify showSwapButtons later)
}

function updateBattleUI(payload) {
    if (!inBattle || payload.battleId !== currentBattle.id) return;

    console.log("Battle update:", payload);
    payload.logUpdate?.forEach(msg => addLogMessage(msg));

    // Update HP based on whose Genmon was affected
    if (payload.defenderGenmonUpdate) {
        const update = payload.defenderGenmonUpdate;
        if (currentBattle.myGenmon?.uniqueId === update.uniqueId) {
            currentBattle.myGenmon.currentHp = update.currentHp;
             updateBattleParticipantUI(battlePlayerGenmonName, battlePlayerHp, battlePlayerMaxHp, battlePlayerHpBar, currentBattle.myGenmon);
             flashElement(battlePlayerInfo); // Flash player side
        } else if (currentBattle.opponentGenmon?.uniqueId === update.uniqueId) {
            currentBattle.opponentGenmon.currentHp = update.currentHp;
             updateBattleParticipantUI(battleOpponentGenmonName, battleOpponentHp, battleOpponentMaxHp, battleOpponentHpBar, currentBattle.opponentGenmon);
             flashElement(battleOpponentInfo); // Flash opponent side
        }
    }
     // Handle wild genmon update separately if structure differs
     if (payload.wildGenmonUpdate && currentBattle.type === 'PvE') {
         const update = payload.wildGenmonUpdate;
          if (currentBattle.opponentGenmon?.uniqueId === update.uniqueId) {
            currentBattle.opponentGenmon.currentHp = update.currentHp;
             updateBattleParticipantUI(battleOpponentGenmonName, battleOpponentHp, battleOpponentMaxHp, battleOpponentHpBar, currentBattle.opponentGenmon);
        }
     }

     // Update opponent name if it was just 'Wild' and we got player ID
     if (currentBattle.type === 'PvP' && payload.defenderId && !currentBattle.opponentPlayerId) {
         // Might need better logic if opponent name isn't sent initially
     }

}

function endBattleUI(payload) {
     if (!inBattle || payload.battleId !== currentBattle.id) return;
     console.log("Battle ended:", payload);
     inBattle = false;
     currentBattle.myTurn = false;
     currentBattle.waitingForAction = false;

    // Add final log messages, avoiding duplicates
    const existingMsgs = Array.from(battleLog.querySelectorAll('li')).map(li => li.textContent);
    payload.finalLog?.forEach(msg => {
         if (!existingMsgs.includes(msg)) {
              addLogMessage(msg, payload.winnerId === playerId ? 'win' : (payload.loserId === playerId ? 'loss' : 'info'));
         }
     });

    const finalMessage = payload.winnerId === playerId
        ? `You won!`
        : (payload.loserId === playerId ? `You lost!` : (payload.forfeited ? "Opponent fled/disconnected." : "Battle ended.")); // Add more cases like draw?
    battleTurnIndicator.textContent = `Battle Over! ${finalMessage}`;
    hideActionButtons();
    hideMoveButtons();

    // Keep battle interface visible for a bit
    setTimeout(() => {
         if (!inBattle) { // Check again
              battleInterface.style.display = 'none';
              playerInfoPanel.style.display = 'block'; // Show map info again
               // Team list & active genmon info should have been updated by TEAM_UPDATE from server
         }
    }, 5000); // Hide after 5 seconds
}


// --- Battle Button Logic ---

// Show Fight, Catch, Swap, Flee
function showActionButtons() {
    actionButtonsContainer.style.display = 'grid'; // Or flex, depending on CSS
    moveButtonsContainer.style.display = 'none';
    // Enable/disable based on context (e.g., disable Catch in PvP)
    fightButton.disabled = false;
    catchButton.disabled = (currentBattle.type !== 'PvE');
    swapButton.disabled = false; // TODO: Disable if only 1 genmon or all others fainted
    fleeButton.disabled = (currentBattle.type !== 'PvE'); // TODO: Allow forfeit in PvP later?
}

function hideActionButtons() {
    actionButtonsContainer.style.display = 'none';
}

// Show the 4 moves of the active Genmon
function showMoveButtons() {
    actionButtonsContainer.style.display = 'none';
    moveButtonsContainer.style.display = 'grid'; // Or flex
    moveButtonsContainer.innerHTML = ''; // Clear old moves

    const activeGenmon = currentBattle.myGenmon; // Assumes currentBattle.myGenmon is up-to-date
    if (!activeGenmon || !activeGenmon.moves) return;

    activeGenmon.moves.forEach(moveName => {
        const button = document.createElement('button');
        button.textContent = moveName;
        // TODO: Add move details (PP, Type) on hover/ R-click?
        button.onclick = () => {
            if (currentBattle.myTurn && currentBattle.waitingForAction) {
                sendMessage('SELECT_MOVE', { battleId: currentBattle.id, moveName });
                hideMoveButtons(); // Hide after selection
                 battleTurnIndicator.textContent = "Waiting for result...";
                 currentBattle.waitingForAction = false; // Action sent
            }
        };
        moveButtonsContainer.appendChild(button);
    });

     // Add a Back button
     const backButton = document.createElement('button');
     backButton.textContent = 'Back';
     backButton.classList.add('back-button');
     backButton.onclick = () => {
          showActionButtons(); // Go back to Fight/Catch etc.
          hideMoveButtons();
     };
     moveButtonsContainer.appendChild(backButton);
}

function hideMoveButtons() {
    moveButtonsContainer.style.display = 'none';
}

// TODO: Implement showSwapButtons() to display team list for switching during battle


// --- Button Event Listeners (Connect HTML buttons) ---
fightButton.onclick = () => {
     if (currentBattle.myTurn && currentBattle.waitingForAction) {
        showMoveButtons();
        hideActionButtons();
     }
 };

catchButton.onclick = () => {
     if (currentBattle.myTurn && currentBattle.waitingForAction && currentBattle.type === 'PvE') {
         sendMessage('ATTEMPT_CATCH', { battleId: currentBattle.id });
         hideActionButtons(); // Hide after selection
         battleTurnIndicator.textContent = "Attempting catch...";
         currentBattle.waitingForAction = false;
     }
 };

swapButton.onclick = () => {
    // TODO: Implement swapping logic
    if (currentBattle.myTurn && currentBattle.waitingForAction) {
        addLogMessage("Swapping not implemented yet.", "error");
        // showSwapButtons(); // Call the function to show team list for swapping
        // hideActionButtons();
    }
};

fleeButton.onclick = () => {
    if (currentBattle.myTurn && currentBattle.waitingForAction && currentBattle.type === 'PvE') {
         sendMessage('FLEE_BATTLE', { battleId: currentBattle.id }); // Need server handler for this
         hideActionButtons();
         battleTurnIndicator.textContent = "Attempting to flee...";
         currentBattle.waitingForAction = false;
    } else if (currentBattle.type === 'PvP') {
         addLogMessage("Cannot flee from a Trainer battle!", "error");
    }
};


// --- Duel Request UI ---
function showDuelRequest(challengerId, challengerName) {
    hideDuelRequest(); // Hide any previous prompt first
    pendingDuelChallengerId = challengerId;
    duelRequesterName.textContent = challengerName || challengerId; // Use name if provided
    duelPrompt.style.display = 'block';
}

function hideDuelRequest() {
    pendingDuelChallengerId = null;
    duelPrompt.style.display = 'none';
}

acceptDuelButton.onclick = () => {
    if (pendingDuelChallengerId) {
        sendMessage('RESPOND_DUEL', { challengerId: pendingDuelChallengerId, accepted: true });
        hideDuelRequest();
    }
};

declineDuelButton.onclick = () => {
     if (pendingDuelChallengerId) {
        sendMessage('RESPOND_DUEL', { challengerId: pendingDuelChallengerId, accepted: false });
        hideDuelRequest();
    }
};


// --- Utility Functions ---
function addLogMessage(message, type = 'normal') {
    const li = document.createElement('li');
    li.textContent = message;
    li.classList.add(`log-${type}`);
    battleLog.appendChild(li);
    battleLog.parentElement.scrollTop = battleLog.parentElement.scrollHeight; // Auto-scroll
}

function updateHpBar(barElement, current, max) {
    const percentage = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
    barElement.style.width = `${percentage}%`;
    barElement.classList.remove('low', 'medium');
    if (percentage <= 25) barElement.classList.add('low');
    else if (percentage <= 50) barElement.classList.add('medium');
}

function flashElement(element) {
    if (!element) return;
    element.style.transition = 'outline 0.1s ease-in-out';
    element.style.outline = '3px solid yellow';
    setTimeout(() => { element.style.outline = 'none'; }, 300);
}

function stringToColor(str) { /* Keep as is */
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    let color = '#';
    for (let i = 0; i < 3; i++) {
        const value = (hash >> (i * 8)) & 0xFF;
        color += ('00' + value.toString(16)).substr(-2);
    }
    return color;
}

function showInfoMessage(message) {
     // Simple alert for now, replace with a temporary on-screen message later
     // alert(message);
     addLogMessage(`[INFO] ${message}`, 'info'); // Add to battle log if visible, or a general log area
     console.log(`[INFO] ${message}`);
}

// --- Initialize ---
connectWebSocket();