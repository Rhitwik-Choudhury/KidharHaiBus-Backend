const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const Driver = require("./models/Driver");
const Bus = require("./models/Bus");

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

// Apply CORS BEFORE routes
app.use(cors(corsOptions));
app.options(/^\/api\/.*/, cors(corsOptions));
app.options(/^\/socket\.io\/.*/, cors(corsOptions));

app.use(express.json());

// ---------------------------
// Attach io to req for REST controllers
// ---------------------------
app.use((req, _res, next) => {
  req.io = io;
  next();
});

// ---------------------------
// DB connection
// ---------------------------
require("./config/db")();

// ---------------------------
// Health route
// ---------------------------
app.get("/health", (_req, res) => res.json({ ok: true }));

// ---------------------------
// API routes
// ---------------------------
app.use("/api/auth", authRoutes);
app.use("/api/parent", parentRoutes);
app.use("/api/school", schoolRoutes);
app.use("/api/driver", driverRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/buses", busRoutes);

// ---------------------------
// Socket.IO
// ---------------------------
// const io = new Server(server, {
//   path: "/socket.io",
//   cors: {
//     origin: (origin, cb) => {
//       logOrigin(origin);
//       if (!origin) return cb(null, true);
//       if (allowed.includes(origin)) return cb(null, true);
//       console.error(`[Socket.IO CORS] Not allowed: ${origin}`);
//       return cb(new Error("Not allowed by CORS"));
//     },
//     methods: ["GET", "POST"],
//     credentials: true,
//   },
// });

const io = new Server(server, {
  path: "/socket.io",
  cors: {
    origin: "*",   // ✅ FIX
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"], // ✅ important
});

io.on("connection", (socket) => {
  console.log("🚐 Client connected:", socket.id);

  // ---------------------------
  // Parent / client joins their bus room
  // Example room: bus_<busId>
  // ---------------------------
  socket.on("joinBusRoom", ({ busId }) => {
    if (!busId) return;
    socket.join(`bus_${busId}`);
    console.log(`Socket ${socket.id} joined room bus_${busId}`);
  });

  socket.on("leaveBusRoom", ({ busId }) => {
    if (!busId) return;
    socket.leave(`bus_${busId}`);
    console.log(`Socket ${socket.id} left room bus_${busId}`);
  });

  // ---------------------------
  // Driver sends live location
  // This now updates ONLY the assigned bus room
  // ---------------------------
  socket.on("driverLocation", async (data = {}) => {
    try {
      const { driverId, busId, lat, lng } = data;

      if (!driverId || !busId || lat === undefined || lng === undefined) {
        socket.emit("trackingError", {
          message: "driverId, busId, lat and lng are required",
        });
        return;
      }

      const driver = await Driver.findById(driverId);
      if (!driver) {
        socket.emit("trackingError", { message: "Driver not found" });
        return;
      }

      if (!driver.busId || String(driver.busId) !== String(busId)) {
        socket.emit("trackingError", {
          message: "Driver is not assigned to this bus",
        });
        return;
      }

      // if (!driver.isOnTrip) {
      //   socket.emit("trackingError", {
      //     message: "Trip is not active. Start trip first.",
      //   });
      //   return;
      // }
      console.log("Driver isOnTrip:", driver.isOnTrip);

      // TEMP FIX (for debugging)
      if (!driver.isOnTrip) {
        console.log("⚠️ Driver not on trip, but allowing location for now");
      }

      const bus = await Bus.findById(busId);
      if (!bus) {
        socket.emit("trackingError", { message: "Bus not found" });
        return;
      }

      const now = new Date();

      driver.lastLocation = { lat, lng };
      driver.lastLocationUpdatedAt = now;
      await driver.save();

      bus.currentLocation = { lat, lng };
      bus.lastLocationUpdatedAt = now;
      await bus.save();

      io.to(`bus_${busId}`).emit("location-update", {
        busId,
        lat,
        lng,
        lastLocationUpdatedAt: now,
      });
    } catch (error) {
      console.error("Socket driverLocation error:", error);
      socket.emit("trackingError", {
        message: "Failed to update driver location",
      });
    }
  });

  // ---------------------------
  // Trip start event
  // Only notify that bus room
  // ---------------------------
  socket.on("trip:start", async (payload = {}) => {
    try {
      const { driverId, busId } = payload;
      console.log("🚀 Trip start received:", payload);
      if (!driverId || !busId) {
        socket.emit("trackingError", {
          message: "driverId and busId are required to start trip",
        });
        return;
      }

      const driver = await Driver.findById(driverId);
      const bus = await Bus.findById(busId);

      if (!driver || !bus) {
        socket.emit("trackingError", {
          message: "Driver or bus not found",
        });
        return;
      }

      if (!driver.busId || String(driver.busId) !== String(busId)) {
        socket.emit("trackingError", {
          message: "Driver is not assigned to this bus",
        });
        return;
      }

      driver.isOnTrip = true;
      await driver.save();

      bus.tripStatus = "started";
      bus.tripStartedAt = new Date();
      bus.tripEndedAt = null;
      await bus.save();

      io.to(`bus_${busId}`).emit("tripStatus", {
        busId,
        status: "started",
        at: Date.now(),
      });
    } catch (error) {
      console.error("Socket trip:start error:", error);
      socket.emit("trackingError", {
        message: "Failed to start trip",
      });
    }
  });

  // ---------------------------
  // Trip end event
  // Only notify that bus room
  // ---------------------------
  socket.on("trip:end", async (payload = {}) => {
    try {
      const { driverId, busId } = payload;

      if (!driverId || !busId) {
        socket.emit("trackingError", {
          message: "driverId and busId are required to end trip",
        });
        return;
      }

      const driver = await Driver.findById(driverId);
      const bus = await Bus.findById(busId);

      if (!driver || !bus) {
        socket.emit("trackingError", {
          message: "Driver or bus not found",
        });
        return;
      }

      if (!driver.busId || String(driver.busId) !== String(busId)) {
        socket.emit("trackingError", {
          message: "Driver is not assigned to this bus",
        });
        return;
      }

      driver.isOnTrip = false;
      await driver.save();

      bus.tripStatus = "ended";
      bus.tripEndedAt = new Date();
      await bus.save();

      io.to(`bus_${busId}`).emit("tripStatus", {
        busId,
        status: "ended",
        at: Date.now(),
      });
    } catch (error) {
      console.error("Socket trip:end error:", error);
      socket.emit("trackingError", {
        message: "Failed to end trip",
      });
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ Client disconnected:", socket.id);
  });
});

// ---------------------------
// Start server
// ---------------------------
const PORT = process.env.PORT || 5000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on ${PORT}`);
});