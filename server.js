// server.js
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

// Routes
const authRoutes = require('./routes/authRoutes');
const parentRoutes = require('./routes/parentRoutes');
const schoolRoutes = require('./routes/schoolRoutes');
const driverRoutes = require('./routes/driverRoutes');

dotenv.config();

const app = express();
const server = http.createServer(app);

// ---------------------------
// CORS (read from env)
// ---------------------------
// Set in Railway → Variables, e.g.:
// ALLOWED_ORIGINS=https://gleaming-mandazi-ccf976.netlify.app,http://localhost:3000
const allowed = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Express CORS options (handles preflight)
const corsOptions = {
  origin(origin, cb) {
    // allow non-browser clients (no Origin header)
    if (!origin) return cb(null, true);
    return allowed.includes(origin)
      ? cb(null, true)
      : cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 204,
};

// Apply CORS before any routes/middleware
app.use(cors(corsOptions));
// Ensure all preflights get a quick OK
app.options('*', cors(corsOptions));
app.options('/socket.io/*', cors(corsOptions));

// Body parser
app.use(express.json());

// ---------------------------
// DB connection
// ---------------------------
require('./config/db')();

// ---------------------------
// Health check
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
  path: '/socket.io', // explicit (default is this, but let's be clear)
  cors: {
    origin: allowed,               // <-- array from ALLOWED_ORIGINS
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// (optional) log connection errors to see details in Railway logs
io.engine.on('connection_error', (err) => {
  console.log('⚠️ socket.io connection error:', {
    code: err.code,
    message: err.message,
    context: err.context,
  });
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

// ---------------------------
// Start server
// ---------------------------
const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on ${PORT}`));
