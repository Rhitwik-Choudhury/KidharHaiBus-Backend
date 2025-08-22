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
const contactRoutes = require('./routes/contactRoutes'); // <-- ADD

dotenv.config();

const app = express();
const server = http.createServer(app);

// ---------------------------
// CORS (env-driven allowlist + sensible dev defaults)
// Railway -> ALLOWED_ORIGINS=https://gleaming-mandazi-ccf976.netlify.app,http://localhost:5173,http://localhost:3000
// ---------------------------
const defaultAllowed = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  process.env.CLIENT_URL, // e.g., https://kidharhaibus.app
  'https://gleaming-mandazi-ccf976.netlify.app'
].filter(Boolean);

const envAllowed = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const allowed = Array.from(new Set([...defaultAllowed, ...envAllowed]));

function logOrigin(origin) {
  if (origin) console.log('[CORS] request origin:', origin);
  else console.log('[CORS] request origin: <none/null> (Postman/native app?)');
}

const corsOptions = {
  origin: (origin, cb) => {
    logOrigin(origin);
    if (!origin) return cb(null, true);            // allow curl/Postman/native apps
    if (allowed.includes(origin)) return cb(null, true);
    console.error(`[CORS] Not allowed by CORS: ${origin}`);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['set-cookie'],
  optionsSuccessStatus: 204
};

// behind proxy (Railway/Netlify) for secure cookies, real IPs
app.set('trust proxy', 1);

// CORS must be before routes
app.use(cors(corsOptions));

// Preflight (use regex paths; avoid bare "*" which breaks path-to-regexp)
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
app.use('/api/contact', contactRoutes); // <-- ADD (supports POST /api/contact and /api/contact/send if coded)

// ---------------------------
// Socket.IO (mirror CORS policy)
// ---------------------------
const io = new Server(server, {
  path: '/socket.io',
  cors: {
    origin: (origin, cb) => {
      logOrigin(origin);
      if (!origin) return cb(null, true);
      if (allowed.includes(origin)) return cb(null, true);
      console.error(`[Socket.IO CORS] Not allowed: ${origin}`);
      return cb(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST'],
    credentials: true
  }
});

io.engine.on('connection_error', (err) => {
  console.log('⚠️ socket.io connection error:', {
    code: err.code,
    message: err.message,
    context: err.context
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
