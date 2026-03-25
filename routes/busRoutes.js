const express = require("express");
const router = express.Router();

const {
  createBus,
  getAllBuses,
  getBusById,
  assignDriverToBus,
  removeDriverFromBus,
  updateBus,
  deleteBus,
  getBusLiveLocation,
  refreshStudentCount,
  getUnassignedDrivers,
} = require("../controllers/busController");

const auth = require("../middleware/authMiddleware");

// Bus CRUD
router.post("/", auth, createBus);
router.get("/", auth, getAllBuses);
router.get("/unassigned-drivers", auth, getUnassignedDrivers);
router.get("/:busId", auth, getBusById);
router.put("/:busId", auth, updateBus);
router.delete("/:busId", auth, deleteBus);

// Driver assignment
router.put("/:busId/assign-driver", auth, assignDriverToBus);
router.put("/:busId/remove-driver", auth, removeDriverFromBus);

// Tracking helpers
router.get("/:busId/live-location", auth, getBusLiveLocation);
router.put("/:busId/refresh-student-count", auth, refreshStudentCount);

module.exports = router;