const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
    origin: [
        "https://ludo-frontend-gray.vercel.app", 
        "http://localhost:5173",                
    ],
    methods: ["GET", "POST"],
    credentials: true, 
}

});

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Ludo Challenge Pool Server is Running!');
});

// --- CHALLENGE POOL & MATCH STATE ---
let challenges = [];
let matches = [];

// === FILE PERSISTENCE ===
const MATCHES_FILE_PATH = path.join(__dirname, 'matches.json');

// Ensure matches.json exists
if (!fs.existsSync(MATCHES_FILE_PATH)) {
    fs.writeFileSync(MATCHES_FILE_PATH, JSON.stringify([]));
}

function saveMatchesToFile() {
    fs.writeFileSync(MATCHES_FILE_PATH, JSON.stringify(matches, null, 2));
}

function loadMatchesFromFile() {
    try {
        const data = fs.readFileSync(MATCHES_FILE_PATH, 'utf8');
        matches = JSON.parse(data);
        console.log(`[Server] Loaded ${matches.length} matches from file.`);
    } catch (err) {
        console.log('[Server] No previous match file found. Starting fresh.');
        matches = [];
    }
}

// Load matches on server start
loadMatchesFromFile();

// === SOCKET HANDLING ===
io.on('connection', (socket) => {
    console.log('✅ Socket connected:', socket.id);

    socket.emit('updateChallenges', getClientChallenges(socket.id));
    socket.emit('updateMatches', getClientMatches());

    // === CREATE CHALLENGE ===
    socket.on('challenge:create', (data, ack) => {
        if (challenges.find(c => c.createdBy === socket.id)) {
            if (ack) ack(false);
            return;
        }

        const name = data.name || `Player_${socket.id.substring(0, 4)}`;
        const amount = parseInt(data.amount);

        const challenge = {
            id: "challenge-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
            name,
            amount,
            createdBy: socket.id,
        };

        challenges.push(challenge);
        socket.emit('yourChallengeId', challenge.id);
        updateAllQueues();
        if (ack) ack(true);
    });

    // === ACCEPT CHALLENGE ===
    socket.on('challenge:accept', (data, ack) => {
        const challenge = challenges.find(c => c.id === data.challengeId);
        if (!challenge || challenge.createdBy === socket.id) {
            if (ack) ack(false);
            return;
        }

        challenges = challenges.filter(c => c.id !== data.challengeId);

        const playerBName = data.name || `Player_${socket.id.substring(0, 4)}`;
        const generatedLudoAppCode = Math.floor(100000 + Math.random() * 900000).toString();

        const match = {
            id: "match-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
            playerA: { id: challenge.createdBy, name: challenge.name },
            playerB: { id: socket.id, name: playerBName },
            amount: challenge.amount,
            generatedRoomCode: generatedLudoAppCode,
            playerResults: {},
        };

        matches.push(match);
        saveMatchesToFile();
        updateAllQueues();

        io.to(challenge.createdBy).emit('matchFound', {
            roomId: match.id,
            generatedRoomCode: match.generatedRoomCode,
        });
        io.to(socket.id).emit('matchFound', {
            roomId: match.id,
            generatedRoomCode: match.generatedRoomCode,
        });

        if (ack) ack(true);
    });

    // === JOIN ROOM ===
    socket.on('joinRoom', ({ roomId, userName }) => {
        const match = matches.find(m => m.id === roomId);
        if (!match) {
            console.log(`[❌ Server] Room NOT FOUND for ID: ${roomId}`);
            socket.emit('roomNotFound');
            return;
        }

        console.log(`[Server] ${userName} joined room: ${roomId}`);
        socket.join(roomId);

        const socketsInRoom = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
        console.log(`[Server] Sockets in room ${roomId}:`, socketsInRoom);

        const roomData = {
            players: [match.playerA, match.playerB],
            generatedRoomCode: match.generatedRoomCode,
        };

        io.to(roomId).emit('roomStateUpdate', roomData);
    });

    // === USER PROVIDES ROOM CODE ===
    socket.on('userProvidedRoomCode', ({ roomId, code }) => {
        const match = matches.find(m => m.id === roomId);
        if (!match) return;

        match.generatedRoomCode = code;
        saveMatchesToFile();

        io.to(roomId).emit('roomStateUpdate', {
            players: [match.playerA, match.playerB],
            generatedRoomCode: code,
        });
    });

    // === DISCONNECT ===
    socket.on('disconnect', () => {
        console.log(`❌ Socket disconnected: ${socket.id}`);

        challenges = challenges.filter(c => c.createdBy !== socket.id);

        const leftMatches = matches.filter(m => m.playerA.id === socket.id || m.playerB.id === socket.id);
        if (leftMatches.length) {
            leftMatches.forEach(m => {
                io.to(m.playerA.id).emit('gameEnd', { message: 'Opponent left the match.' });
                io.to(m.playerB.id).emit('gameEnd', { message: 'Opponent left the match.' });
            });
        }

        matches = matches.filter(m => m.playerA.id !== socket.id && m.playerB.id !== socket.id);
        saveMatchesToFile();
        updateAllQueues();
    });
});

// === HELPERS ===
function updateAllQueues() {
    io.emit('updateChallenges', getClientChallenges());
    io.emit('updateMatches', getClientMatches());
}

function getClientChallenges(requestorId = null) {
    return challenges.map(ch => ({
        ...ch,
        own: requestorId ? ch.createdBy === requestorId : undefined,
    }));
}

function getClientMatches() {
    return matches.map(m => ({
        id: m.id,
        playerA: m.playerA,
        playerB: m.playerB,
        amount: m.amount,
    }));
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log("🚀 Server running on port", PORT);
});
