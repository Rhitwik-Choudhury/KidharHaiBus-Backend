
const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

// ---------------------------
// Load ENV FIRST
// ---------------------------
dotenv.config();

// ---------------------------
// Create APP FIRST
// ---------------------------
const app = express();
const server = http.createServer(app);

// ---------------------------
// Routes IMPORT
// ---------------------------
const authRoutes = require("./routes/authRoutes");
const parentRoutes = require("./routes/parentRoutes");
const schoolRoutes = require("./routes/schoolRoutes");
const driverRoutes = require("./routes/driverRoutes");
const contactRoutes = require("./routes/contactRoutes");
const studentRoutes = require("./routes/studentRoutes");
const busRoutes = require("./routes/busRoutes");
const passwordRoutes = require("./routes/passwordRoutes");
const placeRoutes = require("./routes/placeRoutes");

// ---------------------------
// CORS setup
// ---------------------------
const defaultAllowed = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  process.env.CLIENT_URL,
  "https://gleaming-mandazi-ccf976.netlify.app",
  "https://trackefy.in",
  "https://www.trackefy.in",
].filter(Boolean);

const envAllowed = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const allowed = Array.from(new Set([...defaultAllowed, ...envAllowed]));

function logOrigin(origin) {
  if (origin) console.log("[CORS] request origin:", origin);
  else console.log("[CORS] request origin: <none/null>");
}

const corsOptions = {
  origin: (origin, cb) => {
    logOrigin(origin);
    if (!origin) return cb(null, true);
    if (allowed.includes(origin)) return cb(null, true);
    console.error(`[CORS] Not allowed by CORS: ${origin}`);
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  optionsSuccessStatus: 204,
};

app.set("trust proxy", 1);

app.use(cors(corsOptions));
app.options(/^\/api\/.*/, cors(corsOptions));
app.options(/^\/socket\.io\/.*/, cors(corsOptions));

app.use(express.json());

// ---------------------------
// Attach io to req
// ---------------------------
app.use((req, _res, next) => {
  req.io = io;
  next();
});

// ---------------------------
// Database is connected in startServer(), before accepting traffic.

// ---------------------------
app.get("/health", (_req, res) => res.json({ ok: true }));

// ---------------------------
app.use("/api/auth", authRoutes);
app.use("/api/parent", parentRoutes);
app.use("/api/school", schoolRoutes);
app.use("/api/driver", driverRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/buses", busRoutes);
app.use("/api/password", passwordRoutes);
app.use("/api/places", placeRoutes);
const routePlanningRoutes = require("./routes/routePlanningRoutes");
app.use("/api/parent", routePlanningRoutes.parent);
app.use("/api/school", routePlanningRoutes.school);
app.use("/api/driver", routePlanningRoutes.driver);

// ---------------------------
// Socket.IO
// ---------------------------
const io = new Server(server, {
  path: "/socket.io", cors: corsOptions,
  transports: ["websocket", "polling"], maxHttpBufferSize: 65536,
});
require("./services/socketService").install(io);
app.use(require("./services/routeValidation").errorHandler);

async function startServer() {
  await require("./config/db")();
  await Promise.all(["PickupRequest", "RouteStop", "RoutePlan", "Trip", "OperationLock", "NotificationReceipt"].map(name => require(`./models/${name}`).init()));
  const PORT = process.env.PORT || 5000;
  return server.listen(PORT, "0.0.0.0", () => console.log(`Server running on ${PORT}`));
}
if (require.main === module) startServer().catch(() => { console.error("Backend startup failed"); process.exitCode = 1; });
module.exports = { app, server, io, startServer };
