// server.js
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

// Routes…
const authRoutes = require('./routes/authRoutes');
const parentRoutes = require('./routes/parentRoutes');
const schoolRoutes = require('./routes/schoolRoutes');
const driverRoutes = require('./routes/driverRoutes');

dotenv.config();

const app = express();
const server = http.createServer(app);

// ---------------------------
// CORS (read allowed origins from env)
// Railway -> ALLOWED_ORIGINS= https://gleaming-mandazi-ccf976.netlify.app,http://localhost:3000
// ---------------------------
const allowed = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);                // allow curl/postman (no Origin)
    return allowed.includes(origin) ? cb(null, true) : cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
// Preflight for API & socket endpoints (REGEX to avoid '*' issues)
app.options(/^\/api\/.*/, cors(corsOptions));
app.options(/^\/socket\.io\/.*/, cors(corsOptions));

app.use(express.json());

// ---------------------------
// DB connection
// ---------------------------
require('./config/db')();

// ---------------------------
// Health
// ---------------------------
app.get('/health', (_req, res) => res.json({ ok: true }));

// ---------------------------
// API routes
// ---------------------------
app.use('/api/auth', authRoutes);
app.use('/api/parent', parentRoutes);
app.use('/api/school', schoolRoutes);
app.use('/api/driver', driverRoutes);

// ---------------------------
// Socket.IO (same CORS policy)
// ---------------------------
const io = new Server(server, {
  path: '/socket.io', // explicit (default)
  cors: {
    origin: allowed,                 // array of allowed origins
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// optional: log handshake errors in Railway logs
io.engine.on('connection_error', (err) => {
  console.log('⚠️ socket.io connection error:', {
    code: err.code,
    message: err.message,
    context: err.context,
  });
});

io.on('connection', (socket) => {
  console.log('🚐 Client connected:', socket.id);

  socket.on('driverLocation', (data) => {
    console.log('📍 driverLocation:', data);
    socket.broadcast.emit('locationUpdate', data);
  });

  socket.on('trip:start', (payload = {}) => {
    const message = { status: 'started', at: Date.now(), ...payload };
    io.emit('tripStatus', message);
  });

  socket.on('trip:end', (payload = {}) => {
    const message = { status: 'ended', at: Date.now(), ...payload };
    io.emit('tripStatus', message);
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

// ---------------------------
// Start server
// ---------------------------
const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on ${PORT}`));
