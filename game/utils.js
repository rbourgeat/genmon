const WebSocket = require('ws');

// Simple unique ID generator
function generateUniqueId() {
    return Math.random().toString(36).substring(2, 11);
}

// Send simple info message to a specific client
function sendInfo(ws, message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'INFO', payload: { message } }));
    } else {
        console.log(`Attempted to send info to closed/invalid WS: ${message}`);
    }
}

// Broadcast message to all connected clients, optionally excluding one
function broadcast(wss, players, message, senderWs = null) {
    const messageString = JSON.stringify(message);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client !== senderWs) {
            client.send(messageString);
        }
    });
}


module.exports = {
    generateUniqueId,
    sendInfo,
    broadcast,
};