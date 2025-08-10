const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

// Routes…
const authRoutes = require('./routes/authRoutes');
const parentRoutes = require('./routes/parentRoutes');
const schoolRoutes = require('./routes/schoolRoutes');
const driverRoutes = require('./routes/driverRoutes');
app.get('/health', (_req, res) => res.json({ ok: true }));

dotenv.config();

const app = express();
const server = http.createServer(app);

// ---- CORS origins from env (comma-separated) ----
const allowed = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// ---- Express middleware ----
app.use(cors({
  origin: allowed.length ? allowed : true,   // allow all in dev if empty
  credentials: true
}));
app.use(express.json());

// ---- DB connection ----
require('./config/db')();

// ---- API routes ----
app.use('/api/auth', authRoutes);
app.use('/api/parent', parentRoutes);
app.use('/api/school', schoolRoutes);
app.use('/api/driver', driverRoutes);

// ---- Socket.IO (share the same allowed origins) ----
const io = new Server(server, {
  cors: {
    origin: allowed.length ? allowed : true,
    methods: ['GET', 'POST'],
    credentials: true,
  }
});

io.on('connection', (socket) => {
  console.log('🚐 Driver/Client connected:', socket.id);

  socket.on('driverLocation', (data) => {
    console.log('📍 Location received from driver:', data);
    socket.broadcast.emit('locationUpdate', data);
  });

  socket.on('trip:start', (payload = {}) => {
    const message = { status: 'started', at: Date.now(), ...payload };
    console.log('▶️ Trip started:', message);
    io.emit('tripStatus', message);
  });

  socket.on('trip:end', (payload = {}) => {
    const message = { status: 'ended', at: Date.now(), ...payload };
    console.log('⏹️ Trip ended:', message);
    io.emit('tripStatus', message);
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on ${PORT}`));
