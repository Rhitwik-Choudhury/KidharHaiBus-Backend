const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const Driver = require("./models/Driver");
const Bus = require("./models/Bus");
const Parent = require("./models/Parent"); // ✅ moved here (global use)
const sendNotification = require("./utils/sendNotification");

const alertState = {};

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
require("./config/db")();

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

// ---------------------------
// Socket.IO
// ---------------------------
const io = new Server(server, {
  path: "/socket.io",
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

io.on("connection", (socket) => {
  console.log("🚐 Client connected:", socket.id);

  socket.on("joinBusRoom", ({ busId }) => {
    if (!busId) return;
    socket.join(`bus_${busId}`);
  });

  socket.on("leaveBusRoom", ({ busId }) => {
    if (!busId) return;
    socket.leave(`bus_${busId}`);
  });

  // ================= DRIVER LOCATION =================
  socket.on("driverLocation", async (data = {}) => {
    try {
      const { driverId, busId, lat, lng } = data;

      const driver = await Driver.findById(driverId);
      const bus = await Bus.findById(busId);

      if (!driver || !bus) return;

      const now = new Date();

      driver.lastLocation = { lat, lng };
      driver.lastLocationUpdatedAt = now;
      await driver.save();

      bus.currentLocation = { lat, lng };
      bus.lastLocationUpdatedAt = now;
      await bus.save();

      const parents = await Parent.find({
        schoolId: driver.schoolId,
      }).populate("children");

      for (const parent of parents) {
        if (!parent.stopLocation) continue;

        const isLinked = parent.children?.some(
          (child) => String(child.busId) === String(bus._id)
        );
        if (!isLinked) continue;

        const getDistance = (a, b, c, d) => {
          const R = 6371e3;
          const toRad = (x) => (x * Math.PI) / 180;
          const φ1 = toRad(a), φ2 = toRad(c);
          const Δφ = toRad(c - a);
          const Δλ = toRad(d - b);
          const val =
            Math.sin(Δφ / 2) ** 2 +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
          return 2 * R * Math.atan2(Math.sqrt(val), Math.sqrt(1 - val));
        };

        const distance = getDistance(
          lat,
          lng,
          parent.stopLocation.lat,
          parent.stopLocation.lng
        );

        const eta = (distance / 8.33) / 60;
        const key = `${parent._id}_${bus._id}`;

        if (!alertState[key]) {
          alertState[key] = { etaSent: false, arrivedSent: false };
        }

        // 🔔 ETA
        if (eta <= 5 && eta > 1 && !alertState[key].etaSent) {
          io.to(`bus_${bus._id}`).emit("alert", {
            type: "ETA_5_MIN",
            message: "Bus will reach in ~5 minutes",
          });

          if (parent.fcmToken) {
            await sendNotification(
              parent.fcmToken,
              "Bus arriving soon",
              "Bus will reach in ~5 minutes"
            );
          }

          alertState[key].etaSent = true;
        }

        // 🔔 ARRIVED
        if (distance <= 100 && !alertState[key].arrivedSent) {
          io.to(`bus_${bus._id}`).emit("alert", {
            type: "ARRIVED",
            message: "Bus has arrived",
          });

          if (parent.fcmToken) {
            await sendNotification(
              parent.fcmToken,
              "Bus Arrived",
              "Bus has reached pickup location"
            );
          }

          alertState[key].arrivedSent = true;
        }
      }

      io.to(`bus_${busId}`).emit("location-update", {
        busId,
        lat,
        lng,
        lastLocationUpdatedAt: now,
      });
    } catch (err) {
      console.error(err);
    }
  });

  // ================= TRIP START =================
  socket.on("trip:start", async ({ driverId, busId }) => {
    try {
      const driver = await Driver.findById(driverId);
      const bus = await Bus.findById(busId);

      if (!driver || !bus) return;

      driver.isOnTrip = true;
      await driver.save();

      bus.tripStatus = "started";
      await bus.save();

      io.to(`bus_${busId}`).emit("alert", {
        type: "TRIP_STARTED",
        message: "Bus trip has started",
      });

      // 🔔 FCM
      const parents = await Parent.find({
        schoolId: driver.schoolId,
      }).populate("children");

      for (const parent of parents) {
        const linked = parent.children?.some(
          (c) => String(c.busId) === String(busId)
        );
        if (!linked) continue;

        if (parent.fcmToken) {
          await sendNotification(
            parent.fcmToken,
            "Trip Started",
            "Bus trip has started"
          );
        }
      }

      Object.keys(alertState).forEach((k) => {
        if (k.endsWith(`_${busId}`)) delete alertState[k];
      });

    } catch (err) {
      console.error(err);
    }
  });

  // ================= TRIP END =================
  socket.on("trip:end", async ({ driverId, busId }) => {
    try {
      const driver = await Driver.findById(driverId);
      const bus = await Bus.findById(busId);

      if (!driver || !bus) return;

      driver.isOnTrip = false;
      await driver.save();

      bus.tripStatus = "ended";
      await bus.save();

      io.to(`bus_${busId}`).emit("alert", {
        type: "TRIP_ENDED",
        message: "Bus trip ended",
      });

    } catch (err) {
      console.error(err);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ Client disconnected:", socket.id);
  });
});

// ---------------------------
const PORT = process.env.PORT || 5000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on ${PORT}`);
});