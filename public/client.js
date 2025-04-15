// Get references to existing and new elements
const arenaMap = document.getElementById('arena-map'); // Rename? mapContainer?
const connectionStatus = document.getElementById('connection-status');
const playerInfoPanel = document.getElementById('player-info-panel'); // Contains team + active genmon info
const playerMoneyDisplay = document.getElementById('player-money'); // New element for money
const teamList = document.getElementById('team-list'); // New UL element for team
const activeGenmonInfo = document.getElementById('active-genmon-info'); // Div for current active genmon details
const activeGenmonName = document.getElementById('active-genmon-name');
const activeGenmonLevel = document.getElementById('active-genmon-level'); // Add level display
const activeGenmonHp = document.getElementById('active-genmon-hp');
const activeGenmonMaxHp = document.getElementById('active-genmon-max-hp');
const activeGenmonHpBar = document.getElementById('active-genmon-hp-bar');
const activeGenmonXpBar = document.getElementById('active-genmon-xp-bar'); // Add XP bar display
const activeGenmonXpText = document.getElementById('active-genmon-xp-text'); // Add XP text display


const battleInterface = document.getElementById('battle-interface');
const battlePlayerInfo = document.getElementById('battle-player-info'); // Player side in battle
const battlePlayerGenmonName = document.getElementById('battle-player-genmon-name');
const battlePlayerGenmonLevel = document.getElementById('battle-player-genmon-level'); // Add level
const battlePlayerHp = document.getElementById('battle-player-hp');
const battlePlayerMaxHp = document.getElementById('battle-player-max-hp');
const battlePlayerHpBar = document.getElementById('battle-player-hp-bar');
const battlePlayerXpBar = document.getElementById('battle-player-xp-bar'); // Add XP bar
const battlePlayerSprite = document.getElementById('battle-player-sprite'); // Img element for player's genmon

const battleOpponentInfo = document.getElementById('battle-opponent-info'); // Opponent side in battle
const battleOpponentName = document.getElementById('battle-opponent-name'); // Wild name or Player ID
const battleOpponentGenmonName = document.getElementById('battle-opponent-genmon-name');
const battleOpponentGenmonLevel = document.getElementById('battle-opponent-genmon-level'); // Add level
const battleOpponentHp = document.getElementById('battle-opponent-hp');
const battleOpponentMaxHp = document.getElementById('battle-opponent-max-hp');
const battleOpponentHpBar = document.getElementById('battle-opponent-hp-bar');
const battleOpponentSprite = document.getElementById('battle-opponent-sprite'); // Img element for opponent's genmon


const battleTurnIndicator = document.getElementById('battle-turn-indicator');
const moveButtonsContainer = document.getElementById('move-buttons');
const actionButtonsContainer = document.getElementById('action-buttons'); // New container for Fight, Catch, Swap, Flee
const battleLog = document.getElementById('battle-log');
const battleLogContainer = document.getElementById('battle-log-container'); // Container for scrolling

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
let players = {}; // Store other players' data { id: { element, x, y, direction, sprite, genmonName, genmonLevel, ... } }
let mapData = [];
let mapWidth = 0;
let mapHeight = 0;
let cellSize = 40; // Should match CSS '.tile' width/height

let myMoney = 0; // Store player money
let myTeam = [];
let myActiveGenmonIndex = 0;
let myDirection = 'down';
let inBattle = false;
let currentBattle = { // Store current battle state details
    id: null,
    type: null, // 'PvE', 'PvP'
    isPlayer1: null, // Track if this client is Player 1 in PvP
    myGenmon: null, // Stores the *full* state of my active genmon
    opponentGenmon: null, // Stores the *full* state of opponent's active genmon (or wild)
    opponentPlayerId: null, // for PvP
    myTurn: false,
    waitingForAction: false, // True when REQUEST_ACTION is received for me
    selectingSwap: false, // True if player is currently choosing a Genmon to swap to
};
let pendingDuelChallengerId = null;


// --- WebSocket Connection ---
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
        } catch (error) { console.error('Failed to parse message or handle:', event.data, error); }
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
        case 'PLAYER_UPDATE': // Handles movement, direction, sprite, level changes
            updatePlayer(message.payload.player);
            break;
        case 'PLAYER_IN_BATTLE':
             updatePlayersInBattle(message.payload.playerIds, true);
             break;
        case 'PLAYER_BATTLE_END':
             updatePlayersInBattle(message.payload.playerIds, false);
             break;

        // Battle Flow
        case 'WILD_BATTLE_START':
             startWildBattleUI(message.payload);
             break;
        case 'DUEL_START':
             startDuelUI(message.payload);
             break;
        case 'REQUEST_ACTION':
             handleRequestAction(message.payload);
             break;
         case 'BATTLE_UPDATE':
             updateBattleUI(message.payload);
             break;
         case 'BATTLE_END':
             endBattleUI(message.payload); // Handles XP/money display
             break;
         case 'REQUEST_SWITCH':
             handleRequestSwitch(message.payload);
             break;

         // Team/Player Data Management
         case 'PLAYER_DATA_UPDATE': // Handles team changes, active index, HP regen, money updates
             updatePlayerData(message.payload);
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

    // Initialize with player's own data from payload.yourPlayer
    updatePlayerData(payload.yourPlayer); // Updates team, index, money
    myDirection = payload.yourPlayer.direction || 'down'; // Assuming this is part of private data now

    // Render Map
    renderMap();

    // Add initial players (received in payload.players)
    for (const id in payload.players) {
        addPlayer(payload.players[id]);
    }

    // Set initial UI state
    inBattle = false;
    battleInterface.style.display = 'none';
    playerInfoPanel.style.display = 'block'; // Show panel now
    hideDuelRequest();
}

function resetGameState() {
    playerId = null;
    players = {};
    myTeam = [];
    myMoney = 0;
    myActiveGenmonIndex = 0;
    mapData = [];
    inBattle = false;
    currentBattle = { id: null, type: null, isPlayer1: null, myGenmon: null, opponentGenmon: null, opponentPlayerId: null, myTurn: false, waitingForAction: false, selectingSwap: false };
    arenaMap.innerHTML = '';
    teamList.innerHTML = '';
    updateActiveGenmonInfo(null); // Clear active info outside battle
    battleInterface.style.display = 'none';
    battleLog.innerHTML = '';
    moveButtonsContainer.innerHTML = '';
    actionButtonsContainer.style.display = 'none';
    updateStatus('Disconnected', false);
    hideDuelRequest();
    // Remove player marker elements from the map
    Object.values(players).forEach(p => p.element?.remove());
    players = {};
    playerMoneyDisplay.textContent = '---'; // Reset money display
}

// --- Map and Player Rendering ---
function renderMap() {
    arenaMap.innerHTML = '';
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
            cell.dataset.x = x;
            cell.dataset.y = y;
            cell.onclick = (e) => handleMapClick(e.target);
            arenaMap.appendChild(cell);
        }
    }
}

function addPlayer(playerData) {
    if (!playerData || !playerData.id || players[playerData.id]) return; // Ignore if invalid or already exists

    // console.log("Adding player:", playerData); // Less verbose logging
    const playerElement = document.createElement('div');
    playerElement.classList.add('player-marker');
    playerElement.id = `player-${playerData.id}`;

    const img = document.createElement('img');
    img.src = playerData.sprite || '/assets/default_player.png'; // Initial sprite
    img.alt = `${playerData.genmonName || playerData.id} (Lvl ${playerData.genmonLevel || '?'})`; // Add level to alt text
    img.onerror = () => {
         console.warn(`Failed to load sprite: ${img.src} for ${playerData.id}`);
         img.src = '/assets/default_player.png';
         img.alt = 'Player';
         playerElement.style.backgroundColor = stringToColor(playerData.id); // Fallback bg color
     };
     playerElement.appendChild(img);

     // Add level display on marker
     const levelDisplay = document.createElement('span');
     levelDisplay.classList.add('player-level-display');
     levelDisplay.textContent = `Lvl ${playerData.genmonLevel || '?'}`;
     playerElement.appendChild(levelDisplay);


    arenaMap.appendChild(playerElement);

    players[playerData.id] = {
        ...playerData, // Store received data
        element: playerElement,
        imgElement: img,
        levelElement: levelDisplay, // Store ref to level display
    };

    // Immediately update position, direction, battle status, level
    updatePlayerElement(players[playerData.id]);
}

function removePlayer(id) {
     if (players[id]) {
        // console.log(`Removing player ${id}`);
        players[id].element?.remove();
        delete players[id];
    }
}

// Handles PLAYER_UPDATE messages
function updatePlayer(playerData) {
    if (!playerData || !playerData.id) return;

    // If player is self, update local state (mostly direction)
    if (playerData.id === playerId) {
        myDirection = playerData.direction;
        // Team/active genmon updates come via PLAYER_DATA_UPDATE
    }

    const player = players[playerData.id];
    if (!player) {
        // Player doesn't exist locally yet, add them
        addPlayer(playerData);
    } else {
        // Player exists, update their state and element
        player.x = playerData.x;
        player.y = playerData.y;
        player.direction = playerData.direction;
        player.inBattle = playerData.inBattle;
        player.sprite = playerData.sprite;
        player.genmonName = playerData.genmonName;
        player.genmonLevel = playerData.genmonLevel; // Update level

        updatePlayerElement(player);
    }
}

// Updates the DOM element based on player state
function updatePlayerElement(player) {
    if (!player || !player.element) return;

    player.element.style.left = `${player.x * cellSize}px`;
    player.element.style.top = `${player.y * cellSize}px`;

     // Update sprite if necessary
     const targetSrc = new URL(player.sprite || '/assets/default_player.png', window.location.href).href;
     const targetAlt = `${player.genmonName || player.id} (Lvl ${player.genmonLevel || '?'})`;
     if (player.imgElement.src !== targetSrc) {
          player.imgElement.src = targetSrc;
     }
     if (player.imgElement.alt !== targetAlt) {
         player.imgElement.alt = targetAlt;
     }
     // Update level display
     if (player.levelElement) {
        player.levelElement.textContent = `Lvl ${player.genmonLevel || '?'}`;
     }

     // TODO: Add/remove direction classes based on player.direction
     // player.element.classList.remove('dir-up', 'dir-down', 'dir-left', 'dir-right');
     // player.element.classList.add(`dir-${player.direction}`);

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
            updatePlayerElement(player); // Update element class
       }
       // Update self state/UI if affected
       if (id === playerId) {
            inBattle = isInBattle;
            playerInfoPanel.style.display = isInBattle ? 'none' : 'block';
            if (!isInBattle) {
                battleInterface.style.display = 'none'; // Hide battle UI if we exit battle
                clearSwapSelectionUI(); // Ensure swap selection UI is cleared
            }
       }
    });
}


// --- Team/Player Data Management UI ---
// Handles PLAYER_DATA_UPDATE messages
function updatePlayerData(payload) {
    if (!payload) return;
    myTeam = payload.team || [];
    myActiveGenmonIndex = payload.activeGenmonIndex;
    myMoney = payload.money;

    // Update money display
    playerMoneyDisplay.textContent = myMoney;

    // Update the team list display (used outside battle and for swap selection)
    renderTeamList();

    // Update the separate "Active Genmon" info panel for outside battle view
    const activeGenmon = (myTeam.length > 0 && myActiveGenmonIndex >= 0 && myActiveGenmonIndex < myTeam.length)
                         ? myTeam[myActiveGenmonIndex]
                         : null;
    updateActiveGenmonInfo(activeGenmon);

    // If currently selecting a swap in battle, re-render team list with swap state
    if (inBattle && currentBattle.selectingSwap) {
         renderTeamListForSwap();
    }
}

// Renders the team list for display outside battle
function renderTeamList() {
    teamList.innerHTML = '';
    myTeam.forEach((genmon, index) => {
        const li = document.createElement('li');
        li.classList.add('team-member');
        if (index === myActiveGenmonIndex) li.classList.add('active');
        if (genmon.currentHp <= 0) li.classList.add('fainted');

        // Genmon Info Column
        const infoDiv = document.createElement('div');
        infoDiv.classList.add('team-member-info');
        const nameSpan = document.createElement('span');
        nameSpan.textContent = `${genmon.name} (Lvl ${genmon.level})`;
        const hpSpan = document.createElement('span');
        hpSpan.textContent = `HP: ${genmon.currentHp}/${genmon.stats.hp}`;
        const xpSpan = document.createElement('span'); // Add XP display
        const xpPercent = (genmon.xp / genmon.xpToNextLevel) * 100;
        xpSpan.textContent = `XP: ${genmon.xp}/${genmon.xpToNextLevel} (${xpPercent.toFixed(1)}%)`;
        infoDiv.appendChild(nameSpan);
        infoDiv.appendChild(hpSpan);
        infoDiv.appendChild(xpSpan); // Add XP to display
        li.appendChild(infoDiv);


        // Buttons Column
        const buttonContainer = document.createElement('div');
        buttonContainer.classList.add('team-buttons');

        // Add swap/release buttons only outside battle
        if (!inBattle) {
            if (index !== myActiveGenmonIndex && genmon.currentHp > 0) {
                const swapBtn = createButton('Set Active', () => sendMessage('SWAP_GENMON_TEAM', { teamIndex: index }));
                buttonContainer.appendChild(swapBtn);
            }
            if (myTeam.length > 1) {
                const releaseBtn = createButton('Release', () => {
                    if (confirm(`Are you sure you want to release ${genmon.name}?`)) {
                        sendMessage('RELEASE_GENMON', { teamIndex: index });
                    }
                }, 'release-button');
                buttonContainer.appendChild(releaseBtn);
            }
        }
        li.appendChild(buttonContainer);

        teamList.appendChild(li);
    });
}

// Helper to create buttons for team list
function createButton(text, onClick, className = null) {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.onclick = (e) => {
        e.stopPropagation(); // Prevent li click if needed
        onClick();
    };
    if (className) btn.classList.add(className);
    return btn;
}

function updateActiveGenmonInfo(genmon) {
     if (genmon && !inBattle) { // Only show this panel when not in battle
         activeGenmonName.textContent = genmon.name;
         activeGenmonLevel.textContent = genmon.level; // Update level
         activeGenmonHp.textContent = genmon.currentHp;
         activeGenmonMaxHp.textContent = genmon.stats.hp;
         updateHpBar(activeGenmonHpBar, genmon.currentHp, genmon.stats.hp);
         // Update XP Bar and Text
         updateXpBar(activeGenmonXpBar, genmon.xp, genmon.xpToNextLevel);
         activeGenmonXpText.textContent = `XP: ${genmon.xp} / ${genmon.xpToNextLevel}`;
         activeGenmonInfo.style.display = 'block';
     } else {
         activeGenmonInfo.style.display = 'none'; // Hide if no active genmon or in battle
     }
 }


// --- Player Movement & Interaction Input ---
document.addEventListener('keydown', (event) => {
    // Ignore input if WebSocket is not connected, in battle, or duel prompt is active
    if (!ws || ws.readyState !== WebSocket.OPEN || inBattle || duelPrompt.style.display !== 'none') return;

    let direction = null;
    switch (event.key) {
        case 'ArrowUp': case 'w': direction = 'up'; break;
        case 'ArrowDown': case 's': direction = 'down'; break;
        case 'ArrowLeft': case 'a': direction = 'left'; break;
        case 'ArrowRight': case 'd': direction = 'right'; break;
        default: return; // Ignore other keys
    }
    event.preventDefault(); // Prevent page scrolling
    sendMessage('MOVE', { direction });
});

function handleMapClick(targetElement) {
    if (inBattle || !targetElement?.dataset) return;

    const targetX = parseInt(targetElement.dataset.x);
    const targetY = parseInt(targetElement.dataset.y);
     if (isNaN(targetX) || isNaN(targetY)) return;

    // Find if another player is on this tile
    let targetPlayerId = null;
    for (const id in players) {
        if (id !== playerId && players[id].x === targetX && players[id].y === targetY) {
            targetPlayerId = id;
            break;
        }
    }

    if (targetPlayerId) {
        // Check if target player is in battle
         if(players[targetPlayerId]?.inBattle) {
             showInfoMessage(`${targetPlayerId} is currently in a battle.`);
             return;
         }
        // Initiate duel
        if (confirm(`Challenge player ${targetPlayerId} to a duel?`)) {
            sendMessage('INITIATE_DUEL', { targetId: targetPlayerId });
        }
    } else {
        // console.log(`Clicked on empty tile (${targetX}, ${targetY})`);
    }
}


// --- Battle UI ---

function startWildBattleUI(payload) {
    console.log("Wild Battle starting:", payload);
    // In PvE, the client is always effectively "Player 1" from the server's perspective
    setupBattleUI('PvE', true, payload.playerGenmon, payload.opponentGenmon, null, payload.battleId, payload.initialLog);

    battleOpponentName.textContent = "Wild"; // Opponent name is 'Wild'
    catchButton.style.display = 'inline-block';
    fleeButton.style.display = 'inline-block';
}

function startDuelUI(payload) {
    console.log("Duel starting:", payload);
    const myPlayerId = playerId;
    const iAmPlayer1 = payload.player1.id === myPlayerId;
    const myInfo = iAmPlayer1 ? payload.player1 : payload.player2;
    const opponentInfo = iAmPlayer1 ? payload.player2 : payload.player1;

    setupBattleUI('PvP', iAmPlayer1, myInfo.genmon, opponentInfo.genmon, opponentInfo.id, payload.battleId, payload.initialLog);

    battleOpponentName.textContent = opponentInfo.id; // Opponent name is their Player ID
    catchButton.style.display = 'none';
    fleeButton.style.display = 'none';
}

// Added isPlayer1 parameter
function setupBattleUI(type, isPlayer1, myGenmonData, opponentGenmonData, opponentPlayerId, battleId, initialLog) {
    inBattle = true;
    currentBattle = {
        id: battleId,
        type: type,
        isPlayer1: isPlayer1, // Store if this client is P1
        myGenmon: myGenmonData ? JSON.parse(JSON.stringify(myGenmonData)) : null,
        opponentGenmon: opponentGenmonData ? JSON.parse(JSON.stringify(opponentGenmonData)) : null,
        opponentPlayerId: opponentPlayerId,
        myTurn: false,
        waitingForAction: false,
        selectingSwap: false,
    };

     if (!currentBattle.myGenmon || !currentBattle.opponentGenmon) {
         console.error("Battle setup failed: Missing Genmon data.", currentBattle);
         addLogMessage("Error setting up battle: Missing Genmon data.", "error");
         inBattle = false; return;
     }

    playerInfoPanel.style.display = 'none';
    battleInterface.style.display = 'block';

    // Populate Battle Info Sides
    updateBattleParticipantUI('player', currentBattle.myGenmon);
    updateBattleParticipantUI('opponent', currentBattle.opponentGenmon);

    // Clear and populate Battle Log
    battleLog.innerHTML = '';
    initialLog?.forEach(msg => addLogMessage(msg));
    scrollLogToBottom();

    showActionButtons();
    hideMoveButtons();

    battleTurnIndicator.textContent = 'Battle Started!';
}

// Update UI for one side of the battle ('player' or 'opponent')
function updateBattleParticipantUI(side, genmon) {
    const nameEl = side === 'player' ? battlePlayerGenmonName : battleOpponentGenmonName;
    const levelEl = side === 'player' ? battlePlayerGenmonLevel : battleOpponentGenmonLevel; // Get level element
    const hpEl = side === 'player' ? battlePlayerHp : battleOpponentHp;
    const maxHpEl = side === 'player' ? battlePlayerMaxHp : battleOpponentMaxHp;
    const hpBarEl = side === 'player' ? battlePlayerHpBar : battleOpponentHpBar;
    const xpBarEl = side === 'player' ? battlePlayerXpBar : null; // Only player has XP bar in battle UI
    const spriteEl = side === 'player' ? battlePlayerSprite : battleOpponentSprite;
    const infoContainer = side === 'player' ? battlePlayerInfo : battleOpponentInfo;

    if (genmon && genmon.stats) { // Check genmon and stats exist
        nameEl.textContent = genmon.name || "???";
        levelEl.textContent = genmon.level || "?"; // Update level display
        hpEl.textContent = typeof genmon.currentHp === 'number' ? genmon.currentHp : "-";
        maxHpEl.textContent = genmon.stats.hp || "-";
        updateHpBar(hpBarEl, genmon.currentHp, genmon.stats.hp);
        // Update XP bar (only for player)
        if (xpBarEl) {
             updateXpBar(xpBarEl, genmon.xp, genmon.xpToNextLevel);
        }

        // Update sprite
        const spriteSrc = genmon.sprite || '/assets/default_player.png';
        if (spriteEl.src !== spriteSrc) { // Avoid unnecessary reloads
            spriteEl.src = spriteSrc;
        }
         spriteEl.alt = genmon.name || "Genmon";
         spriteEl.style.display = 'block';
         spriteEl.onerror = () => { spriteEl.src = '/assets/default_player.png'; spriteEl.alt = 'Genmon'; };
        // Store uniqueId on the container for BATTLE_UPDATE matching
        infoContainer.dataset.genmonUniqueId = genmon.uniqueId || "";
    } else { // Clear UI if no genmon data
        console.warn(`updateBattleParticipantUI called with invalid genmon data for side: ${side}`, genmon);
        nameEl.textContent = '-';
        levelEl.textContent = '-'; // Clear level
        hpEl.textContent = '-';
        maxHpEl.textContent = '-';
        updateHpBar(hpBarEl, 0, 1);
        if (xpBarEl) updateXpBar(xpBarEl, 0, 1); // Clear XP bar
        spriteEl.style.display = 'none';
        infoContainer.dataset.genmonUniqueId = ''; // Clear uniqueId
    }
}


function handleRequestAction(payload) {
     if (!inBattle || !currentBattle || payload.battleId !== currentBattle.id) return;

     const isMyTurn = payload.playerId === playerId;
     currentBattle.myTurn = isMyTurn;
     currentBattle.waitingForAction = isMyTurn;
     currentBattle.selectingSwap = false; // Reset swap selection state

     const turnMessage = isMyTurn ? "Your turn! Choose an action." : `Waiting for opponent...`;
     battleTurnIndicator.textContent = turnMessage;
     addLogMessage(turnMessage, 'turn');
     scrollLogToBottom();

     if (isMyTurn) {
         showActionButtons(); // Show Fight/Catch etc.
         hideMoveButtons();
         clearSwapSelectionUI(); // Ensure team list is not in swap selection mode
     } else {
         hideActionButtons();
         hideMoveButtons();
         clearSwapSelectionUI();
     }
}

function handleRequestSwitch(payload) {
    if (!inBattle || !currentBattle || payload.battleId !== currentBattle.id) return;

     addLogMessage(payload.reason + " Choose another Genmon.", 'info');
     battleTurnIndicator.textContent = "Choose your next Genmon!";
     scrollLogToBottom();

     currentBattle.myTurn = true; // Our turn to *switch*
     currentBattle.waitingForAction = true;
     currentBattle.selectingSwap = true; // Set flag

     hideActionButtons(); // Can't Fight/Catch/Flee
     hideMoveButtons();
     showTeamListForSwap(); // Highlight team list for selection
}

// Handles BATTLE_UPDATE messages
function updateBattleUI(payload) {
    if (!inBattle || !currentBattle || payload.battleId !== currentBattle.id) return;

    console.log("Battle update received:", payload);
    payload.logUpdate?.forEach(msg => addLogMessage(msg));
    scrollLogToBottom();

    let myUpdateData = null;
    let opponentUpdateData = null;

    // Determine which payload part corresponds to self and opponent
    if (currentBattle.type === 'PvP') {
        myUpdateData = currentBattle.isPlayer1 ? payload.p1GenmonUpdate : payload.p2GenmonUpdate;
        opponentUpdateData = currentBattle.isPlayer1 ? payload.p2GenmonUpdate : payload.p1GenmonUpdate;
    } else { // PvE
        myUpdateData = payload.p1GenmonUpdate; // Player is always P1 in PvE payload
        opponentUpdateData = payload.p2GenmonUpdate; // Wild is P2
    }

    // --- Update Local State FIRST ---
    let myGenmonChanged = false;
    let opponentGenmonChanged = false;

    if (myUpdateData && currentBattle.myGenmon?.uniqueId === myUpdateData.uniqueId) {
        // Update HP/XP/Level if different
        if (currentBattle.myGenmon.currentHp !== myUpdateData.currentHp ||
            currentBattle.myGenmon.xp !== myUpdateData.xp ||
            currentBattle.myGenmon.level !== myUpdateData.level) {
            currentBattle.myGenmon.currentHp = myUpdateData.currentHp;
            currentBattle.myGenmon.xp = myUpdateData.xp;
            currentBattle.myGenmon.level = myUpdateData.level;
            currentBattle.myGenmon.xpToNextLevel = myUpdateData.xpToNextLevel;
            currentBattle.myGenmon.stats = myUpdateData.stats; // Update stats too in case of level up
            myGenmonChanged = true;
        }
    } else if (myUpdateData && payload.swapOccurred && (!currentBattle.myGenmon || currentBattle.myGenmon.uniqueId !== myUpdateData.uniqueId)) { // My side swapped
        console.log("Updating local state for MY swap");
        currentBattle.myGenmon = JSON.parse(JSON.stringify(myUpdateData)); // Replace local object
        myGenmonChanged = true;
    }

     if (opponentUpdateData && currentBattle.opponentGenmon?.uniqueId === opponentUpdateData.uniqueId) {
         // Update HP/Level if different (opponent XP not usually shown)
         if (currentBattle.opponentGenmon.currentHp !== opponentUpdateData.currentHp ||
             currentBattle.opponentGenmon.level !== opponentUpdateData.level) {
             currentBattle.opponentGenmon.currentHp = opponentUpdateData.currentHp;
             currentBattle.opponentGenmon.level = opponentUpdateData.level;
             currentBattle.opponentGenmon.stats = opponentUpdateData.stats; // Update stats
             opponentGenmonChanged = true;
         }
     } else if (opponentUpdateData && payload.swapOccurred && (!currentBattle.opponentGenmon || currentBattle.opponentGenmon.uniqueId !== opponentUpdateData.uniqueId)) { // Opponent side swapped
          console.log("Updating local state for OPPONENT swap");
          currentBattle.opponentGenmon = JSON.parse(JSON.stringify(opponentUpdateData)); // Replace local object
         opponentGenmonChanged = true;
     }


    // --- Update UI based on potentially changed local state ---
    if (myGenmonChanged && currentBattle.myGenmon) {
         updateBattleParticipantUI('player', currentBattle.myGenmon);
         flashElement(battlePlayerInfo); // Flash own side
     } else if (myUpdateData && !myGenmonChanged) {
          // Refresh UI even if no major change detected, just in case
          updateBattleParticipantUI('player', currentBattle.myGenmon);
      }


    if (opponentGenmonChanged && currentBattle.opponentGenmon) {
         updateBattleParticipantUI('opponent', currentBattle.opponentGenmon);
         flashElement(battleOpponentInfo); // Flash opponent side
     } else if (opponentUpdateData && !opponentGenmonChanged) {
          // Refresh opponent UI too, just in case
          updateBattleParticipantUI('opponent', currentBattle.opponentGenmon);
      }
}


function endBattleUI(payload) {
     if (!inBattle || !currentBattle || payload.battleId !== currentBattle.id) return;
     console.log("Battle ended:", payload);

     let finalMessage = "Battle Over!";
     const opponentNameToUse = currentBattle.opponentGenmon?.name || 'the Genmon';
     const opponentLevelToUse = currentBattle.opponentGenmon?.level || '?';

     // --- Process Rewards for this Player ---
     if (payload.rewards && payload.rewards[playerId]) {
          const myRewards = payload.rewards[playerId];
          console.log("Received rewards:", myRewards);

          // Update local money
          if (myRewards.moneyGained > 0) {
               myMoney += myRewards.moneyGained;
               playerMoneyDisplay.textContent = myMoney; // Update display immediately
               addLogMessage(`You earned $${myRewards.moneyGained}!`, 'win');
          }

          // Update local team data with XP/Level Ups
          let teamUpdatedLocally = false;
          myRewards.levelUps?.forEach(levelUpInfo => {
               const genmonIndex = myTeam.findIndex(g => g.uniqueId === levelUpInfo.genmonUniqueId);
               if (genmonIndex !== -1) {
                    // Update the local team member directly
                    myTeam[genmonIndex].level = levelUpInfo.newLevel;
                    myTeam[genmonIndex].stats = levelUpInfo.newStats;
                    myTeam[genmonIndex].currentHp = levelUpInfo.newCurrentHp;
                    myTeam[genmonIndex].xp = levelUpInfo.currentXp;
                    myTeam[genmonIndex].xpToNextLevel = levelUpInfo.xpToNext;
                    addLogMessage(`${myTeam[genmonIndex].name} grew to Level ${levelUpInfo.newLevel}!`, 'win');
                    // Could add stat gain details (+X Atk, etc.)
                    flashElement(battlePlayerInfo); // Flash the player info on level up
                    teamUpdatedLocally = true;
               }
          });
          // Update XP for those who didn't level up
           for (const uid in myRewards.xpGained) {
                const genmonIndex = myTeam.findIndex(g => g.uniqueId === uid);
                // Check if this genmon didn't already level up (levelUps is processed first)
                if (genmonIndex !== -1 && !myRewards.levelUps?.some(l => l.genmonUniqueId === uid)) {
                     myTeam[genmonIndex].xp += myRewards.xpGained[uid]; // Add XP gained
                     addLogMessage(`${myTeam[genmonIndex].name} earned ${myRewards.xpGained[uid]} XP.`, 'info');
                     teamUpdatedLocally = true;
                } else if (genmonIndex !== -1) {
                     // Already leveled up, XP was handled there, maybe just log total gain?
                     // addLogMessage(`${myTeam[genmonIndex].name} earned ${myRewards.xpGained[uid]} XP.`, 'info');
                }
           }

          // If local team was updated by rewards, refresh UI elements
          if (teamUpdatedLocally) {
               renderTeamList(); // Update main team list display
               updateActiveGenmonInfo(myTeam[myActiveGenmonIndex]); // Update active info panel
               // Update battle UI if still visible (for the final state)
                if (currentBattle.myGenmon) {
                     const currentBattleMonIndex = myTeam.findIndex(g => g.uniqueId === currentBattle.myGenmon.uniqueId);
                     if (currentBattleMonIndex !== -1) {
                          currentBattle.myGenmon = myTeam[currentBattleMonIndex]; // Sync battle object
                          updateBattleParticipantUI('player', currentBattle.myGenmon);
                     }
                }
          }
     }
      // NOTE: Server also sends PLAYER_DATA_UPDATE after battle end, which will re-sync everything.
      // The local updates here provide immediate feedback.


    // Add final outcome log messages if they aren't already there
    const existingMsgs = new Set(Array.from(battleLog.querySelectorAll('li')).map(li => li.textContent));
    payload.finalLog?.forEach(msg => {
         // Avoid duplicating simple win/loss messages if already handled by rewards
         const isRewardMsg = msg.includes("earned $") || msg.includes("XP.") || msg.includes("grew to Level");
         if (!existingMsgs.has(msg) && !isRewardMsg) {
              addLogMessage(msg, payload.winnerId === playerId ? 'win' : (payload.loserId === playerId ? 'loss' : 'info'));
         }
     });
     scrollLogToBottom();


    // Determine final banner message
    if (payload.caught) finalMessage = `Caught ${opponentNameToUse} (Lvl ${opponentLevelToUse})!`;
    else if (payload.winnerId === playerId) finalMessage = "You won!";
    else if (payload.loserId === playerId) finalMessage = "You lost!";
    else if (payload.forfeited) finalMessage = payload.winnerId ? "Opponent forfeited/disconnected." : "You fled/disconnected.";
    else finalMessage = "Battle ended.";


    battleTurnIndicator.textContent = `Battle Over! ${finalMessage}`;
    hideActionButtons();
    hideMoveButtons();
    clearSwapSelectionUI(); // Clean up team list state

    // Reset battle state *after* processing final updates
    inBattle = false;
    currentBattle = { id: null, type: null, isPlayer1: null, myGenmon: null, opponentGenmon: null, opponentPlayerId: null, myTurn: false, waitingForAction: false, selectingSwap: false };

    // Keep battle interface visible briefly, then hide
    setTimeout(() => {
         // Check if another battle hasn't started immediately
         if (!inBattle) {
              battleInterface.style.display = 'none';
              playerInfoPanel.style.display = 'block'; // Show map info/team list again
         }
    }, 5000); // Hide after 5 seconds
}


// --- Battle Button Logic ---

function showActionButtons() {
    actionButtonsContainer.style.display = 'grid';
    moveButtonsContainer.style.display = 'none';
    // Keep player info panel hidden during action selection unless swapping
    if (!currentBattle.selectingSwap) {
        playerInfoPanel.style.display = 'none';
    }


    if (!currentBattle || !currentBattle.myGenmon) return; // Safety check

    // Enable/disable buttons based on context
    fightButton.disabled = currentBattle.myGenmon.currentHp <= 0;
    catchButton.disabled = (currentBattle.type !== 'PvE') || (currentBattle.myGenmon.currentHp <= 0);
    // Disable swap if no other healthy Genmon available
    const canSwap = myTeam.some((g) => {
         return g.uniqueId !== currentBattle.myGenmon.uniqueId && g.currentHp > 0;
     });
    swapButton.disabled = !canSwap || (currentBattle.myGenmon.currentHp <= 0);
    fleeButton.disabled = (currentBattle.type !== 'PvE') || (currentBattle.myGenmon.currentHp <= 0);
}

function hideActionButtons() {
    actionButtonsContainer.style.display = 'none';
}

function showMoveButtons() {
    actionButtonsContainer.style.display = 'none';
    moveButtonsContainer.style.display = 'grid';
    moveButtonsContainer.innerHTML = ''; // Clear old moves

    const activeGenmon = currentBattle.myGenmon;
    if (!activeGenmon || !activeGenmon.moves) {
        addLogMessage("Error: Cannot find active Genmon's moves.", "error");
        scrollLogToBottom();
        showActionButtons(); // Go back to action buttons
        return;
    }

    activeGenmon.moves.forEach(moveName => {
        const button = document.createElement('button');
        button.textContent = moveName;
        // TODO: Add move details (PP, Type) from moveData on hover/ R-click?
        button.onclick = () => {
            if (currentBattle.myTurn && currentBattle.waitingForAction) {
                sendMessage('SELECT_MOVE', { battleId: currentBattle.id, moveName });
                hideMoveButtons();
                battleTurnIndicator.textContent = "Waiting for result...";
                currentBattle.waitingForAction = false;
            }
        };
        moveButtonsContainer.appendChild(button);
    });

     // Add a Back button to return to Action selection
     const backButton = createButton('Back', () => {
         if (currentBattle.myTurn) { // Only allow going back if it's still conceptually your turn
             showActionButtons();
             hideMoveButtons();
         }
     }, 'back-button');
     moveButtonsContainer.appendChild(backButton);
}

function hideMoveButtons() {
    moveButtonsContainer.style.display = 'none';
}

// Show team list prepared for swap selection
function showTeamListForSwap() {
     currentBattle.selectingSwap = true; // Set flag
     playerInfoPanel.style.display = 'block'; // Show the panel containing the team list
     teamList.style.display = 'block'; // Ensure list is visible
     hideActionButtons(); // Hide fight/catch etc.
     hideMoveButtons(); // Hide moves
     battleTurnIndicator.textContent = "Select a Genmon to switch to.";
     document.getElementById('team-list-header').style.display = 'block'; // Show header
     renderTeamListForSwap(); // Update list items with click handlers
}

// Renders team list items with appropriate classes/listeners for swapping
function renderTeamListForSwap() {
    teamList.innerHTML = ''; // Clear existing list items
     myTeam.forEach((genmon, index) => {
        const li = document.createElement('li');
        li.classList.add('team-member');
        // Highlight fainted/active differently
        if (genmon.uniqueId === currentBattle.myGenmon?.uniqueId) {
             li.classList.add('active'); // Mark the one currently out
             li.classList.add('disabled-swap'); // Can't swap to self
        } else if (genmon.currentHp <= 0) {
            li.classList.add('fainted');
            li.classList.add('disabled-swap'); // Can't swap to fainted
        } else {
            // Healthy and not active: Make selectable
            li.classList.add('selectable-swap');
            li.onclick = () => {
                if (currentBattle.myTurn && currentBattle.waitingForAction && currentBattle.selectingSwap) {
                    sendMessage('SWAP_GENMON_BATTLE', { battleId: currentBattle.id, teamIndex: index });
                    clearSwapSelectionUI(); // Clean up UI after selection
                    battleTurnIndicator.textContent = "Waiting for swap...";
                    currentBattle.waitingForAction = false; // Action sent
                    currentBattle.selectingSwap = false;
                }
            };
        }

        // Genmon Info Column (Re-use rendering logic)
        const infoDiv = document.createElement('div');
        infoDiv.classList.add('team-member-info');
        const nameSpan = document.createElement('span');
        nameSpan.textContent = `${genmon.name} (Lvl ${genmon.level})`;
        const hpSpan = document.createElement('span');
        hpSpan.textContent = `HP: ${genmon.currentHp}/${genmon.stats.hp}`;
        // Don't need XP display during swap selection probably
        infoDiv.appendChild(nameSpan);
        infoDiv.appendChild(hpSpan);
        li.appendChild(infoDiv);


        teamList.appendChild(li);
    });

    // Remove previous cancel button if it exists
    document.querySelectorAll('.cancel-swap-button').forEach(btn => btn.remove());

     // Add cancel button only if it's a voluntary swap (not forced by faint)
     const mustSwitch = (currentBattle.type === 'PvP' && ((playerId === currentBattle.player1Id && battle.p1MustSwitch) || (playerId === currentBattle.player2Id && battle.p2MustSwitch))) ||
                      (currentBattle.type === 'PvE' && playerId === currentBattle.playerId && battle.p1MustSwitch);

     if (!mustSwitch) {
         const cancelBtn = createButton('Cancel Swap', () => {
             if (currentBattle.selectingSwap) {
                 clearSwapSelectionUI();
                 showActionButtons(); // Go back to normal actions
                 battleTurnIndicator.textContent = "Choose an action.";
             }
         }, 'cancel-swap-button');
         // Add cancel button after the team list within the player info panel
         teamList.insertAdjacentElement('afterend', cancelBtn);
     }
}


function clearSwapSelectionUI() {
     currentBattle.selectingSwap = false;
     // Hide the team list panel ONLY if we are not ending the battle (where it should reappear)
     if (inBattle) {
        playerInfoPanel.style.display = 'none';
     }
     document.getElementById('team-list-header').style.display = 'none'; // Hide header
     // Re-render standard team list to remove swap classes/listeners
     renderTeamList();
     document.querySelectorAll('.cancel-swap-button').forEach(btn => btn.remove());
}


// --- Button Event Listeners ---
fightButton.onclick = () => {
     if (currentBattle.myTurn && currentBattle.waitingForAction) {
        showMoveButtons();
        hideActionButtons();
     }
 };

catchButton.onclick = () => {
     if (currentBattle.myTurn && currentBattle.waitingForAction && currentBattle.type === 'PvE') {
         sendMessage('ATTEMPT_CATCH', { battleId: currentBattle.id });
         hideActionButtons();
         hideMoveButtons();
         battleTurnIndicator.textContent = "Attempting catch...";
         currentBattle.waitingForAction = false;
     }
 };

swapButton.onclick = () => {
    if (currentBattle.myTurn && currentBattle.waitingForAction) {
        const canSwap = myTeam.some((g) => {
            return g.uniqueId !== currentBattle.myGenmon?.uniqueId && g.currentHp > 0;
        });
         if (canSwap) {
             showTeamListForSwap(); // Show team list UI for selection
         } else {
             addLogMessage("No healthy Genmon to swap to!", "error");
             scrollLogToBottom();
         }
    }
};

fleeButton.onclick = () => {
    if (currentBattle.myTurn && currentBattle.waitingForAction && currentBattle.type === 'PvE') {
         sendMessage('FLEE_BATTLE', { battleId: currentBattle.id });
         hideActionButtons();
         hideMoveButtons();
         battleTurnIndicator.textContent = "Attempting to flee...";
         currentBattle.waitingForAction = false;
    } else if (currentBattle.type === 'PvP') {
         addLogMessage("Cannot flee from a Trainer battle!", "error");
         scrollLogToBottom();
    }
};


// --- Duel Request UI ---
function showDuelRequest(challengerId, challengerName) {
    hideDuelRequest(); // Hide any previous prompt
    pendingDuelChallengerId = challengerId;
    duelRequesterName.textContent = challengerName || challengerId;
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
    if (!message || typeof message !== 'string' || message.trim() === '') return;
    const li = document.createElement('li');
    // Sanitize message slightly? For now, just set textContent.
    li.textContent = message;
    li.classList.add(`log-${type}`);
    battleLog.appendChild(li);
}

function scrollLogToBottom() {
     if (battleLogContainer) {
        setTimeout(() => {
             battleLogContainer.scrollTop = battleLogContainer.scrollHeight;
        }, 0);
     }
 }

function updateHpBar(barElement, current, max) {
    const currentHp = typeof current === 'number' ? current : 0;
    const maxHp = typeof max === 'number' && max > 0 ? max : 1;
    const percentage = Math.max(0, Math.min(100, (currentHp / maxHp) * 100));

    barElement.style.width = `${percentage}%`;
    barElement.classList.remove('low', 'medium', 'high');
    if (percentage <= 25) barElement.classList.add('low');
    else if (percentage <= 50) barElement.classList.add('medium');
    else barElement.classList.add('high');
}

// Add function to update XP bar
function updateXpBar(barElement, current, max) {
     if (!barElement) return;
    const currentXp = typeof current === 'number' ? current : 0;
    const maxXp = typeof max === 'number' && max > 0 ? max : 1; // XP to next level
    const percentage = Math.max(0, Math.min(100, (currentXp / maxXp) * 100));
    barElement.style.width = `${percentage}%`;
}


function flashElement(element) {
    if (!element) return;
    element.classList.remove('flash');
    void element.offsetWidth;
    element.classList.add('flash');
    setTimeout(() => {
        element.classList.remove('flash');
     }, 300);
}


function stringToColor(str) { // Keep as is
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
     console.log(`[INFO] ${message}`);
     if (inBattle && battleLog) {
          addLogMessage(`[INFO] ${message}`, 'info');
          scrollLogToBottom();
     } else {
         // TODO: Implement a non-battle notification system (e.g., temporary toast message)
         // For now, just log it.
     }
}

// --- Initialize ---
connectWebSocket();