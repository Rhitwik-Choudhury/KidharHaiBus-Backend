const Bus = require("../models/Bus");
const Driver = require("../models/Driver");
const Student = require("../models/Student");

// ================= CREATE BUS =================
exports.createBus = async (req, res) => {
  try {
    const { schoolId, busNumber, carNumber, route, capacity } = req.body;

    if (!schoolId || !busNumber || !carNumber || !route || !capacity) {
      return res.status(400).json({
        message: "schoolId, busNumber, carNumber, route and capacity are required",
      });
    }

    const existingBus = await Bus.findOne({
      schoolId,
      $or: [{ busNumber }, { carNumber }],
    });

    if (existingBus) {
      return res.status(400).json({
        message: "Bus with same bus number or car number already exists for this school",
      });
    }

    const newBus = new Bus({
      schoolId,
      busNumber,
      carNumber,
      route,
      capacity,
      studentCount: 0,
      driverId: null,
      currentLocation: {
        lat: null,
        lng: null,
      },
      tripStatus: "idle",
      lastLocationUpdatedAt: null,
      tripStartedAt: null,
      tripEndedAt: null,
    });

    await newBus.save();

    res.status(201).json({
      message: "Bus created successfully",
      bus: newBus,
    });
  } catch (err) {
    console.error("Create Bus Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
};

// ================= GET ALL BUSES =================
exports.getAllBuses = async (req, res) => {
  try {
    const { schoolId } = req.query;

    const filter = {};
    if (schoolId) filter.schoolId = schoolId;

    const buses = await Bus.find(filter)
      .populate("driverId", "fullName email")
      .sort({ createdAt: -1 });

    res.status(200).json({
      message: "Buses fetched successfully",
      buses,
    });
  } catch (err) {
    console.error("Get All Buses Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
};

// ================= GET SINGLE BUS =================
exports.getBusById = async (req, res) => {
  try {
    const { busId } = req.params;

    const bus = await Bus.findById(busId).populate(
      "driverId",
      "fullName email schoolId busId isOnTrip"
    );

    if (!bus) {
      return res.status(404).json({ message: "Bus not found" });
    }

    res.status(200).json({
      message: "Bus fetched successfully",
      bus,
    });
  } catch (err) {
    console.error("Get Bus By Id Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
};

// ================= ASSIGN DRIVER TO BUS =================
exports.assignDriverToBus = async (req, res) => {
  try {
    const { busId } = req.params;
    const { driverId } = req.body;

    if (!driverId) {
      return res.status(400).json({ message: "driverId is required" });
    }

    const bus = await Bus.findById(busId);
    if (!bus) {
      return res.status(404).json({ message: "Bus not found" });
    }

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    // Optional safety: keep school same
    if (
      bus.schoolId &&
      driver.schoolId &&
      String(bus.schoolId) !== String(driver.schoolId)
    ) {
      return res.status(400).json({
        message: "Driver and bus belong to different schools",
      });
    }

    // If this bus already has another driver, remove that driver's busId
    if (bus.driverId && String(bus.driverId) !== String(driverId)) {
      await Driver.findByIdAndUpdate(bus.driverId, { busId: null });
    }

    // If this driver was already assigned to another bus, remove from old bus
    if (driver.busId && String(driver.busId) !== String(busId)) {
      await Bus.findByIdAndUpdate(driver.busId, { driverId: null });
    }

    bus.driverId = driver._id;
    await bus.save();

    driver.busId = bus._id;
    driver.schoolId = driver.schoolId || bus.schoolId || null;
    await driver.save();

    const updatedBus = await Bus.findById(bus._id).populate(
      "driverId",
      "fullName email schoolId busId"
    );

    res.status(200).json({
      message: "Driver assigned to bus successfully",
      bus: updatedBus,
    });
  } catch (err) {
    console.error("Assign Driver To Bus Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
};

// ================= REMOVE DRIVER FROM BUS =================
exports.removeDriverFromBus = async (req, res) => {
  try {
    const { busId } = req.params;

    const bus = await Bus.findById(busId);
    if (!bus) {
      return res.status(404).json({ message: "Bus not found" });
    }

    if (!bus.driverId) {
      return res.status(400).json({ message: "No driver assigned to this bus" });
    }

    const driverId = bus.driverId;

    bus.driverId = null;
    await bus.save();

    await Driver.findByIdAndUpdate(driverId, {
      busId: null,
      isOnTrip: false,
    });

    res.status(200).json({
      message: "Driver removed from bus successfully",
      bus,
    });
  } catch (err) {
    console.error("Remove Driver From Bus Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
};

// ================= UPDATE BUS =================
exports.updateBus = async (req, res) => {
  try {
    const { busId } = req.params;
    const { busNumber, carNumber, route, capacity } = req.body;

    const bus = await Bus.findById(busId);
    if (!bus) {
      return res.status(404).json({ message: "Bus not found" });
    }

    if (busNumber !== undefined) bus.busNumber = busNumber;
    if (carNumber !== undefined) bus.carNumber = carNumber;
    if (route !== undefined) bus.route = route;
    if (capacity !== undefined) bus.capacity = capacity;

    await bus.save();

    res.status(200).json({
      message: "Bus updated successfully",
      bus,
    });
  } catch (err) {
    console.error("Update Bus Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
};

// ================= DELETE BUS =================
exports.deleteBus = async (req, res) => {
  try {
    const { busId } = req.params;

    const bus = await Bus.findById(busId);
    if (!bus) {
      return res.status(404).json({ message: "Bus not found" });
    }

    // Block deletion if students are assigned to this bus
    const assignedStudentsCount = await Student.countDocuments({ busId: bus._id });

    if (assignedStudentsCount > 0) {
      return res.status(400).json({
        message:
          "Cannot delete this bus because students are still assigned to it. Please reassign or remove those students first.",
      });
    }

    // Unassign driver if present
    if (bus.driverId) {
      await Driver.findByIdAndUpdate(bus.driverId, {
        busId: null,
        isOnTrip: false,
      });
    }

    await Bus.findByIdAndDelete(busId);

    res.status(200).json({
      message: "Bus deleted successfully",
    });
  } catch (err) {
    console.error("Delete Bus Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
};

// ================= GET LIVE LOCATION OF A BUS =================
exports.getBusLiveLocation = async (req, res) => {
  try {
    const { busId } = req.params;

    const bus = await Bus.findById(busId).select(
      "busNumber currentLocation tripStatus lastLocationUpdatedAt driverId"
    );

    if (!bus) {
      return res.status(404).json({ message: "Bus not found" });
    }

    res.status(200).json({
      message: "Bus live location fetched successfully",
      bus,
    });
  } catch (err) {
    console.error("Get Bus Live Location Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
};

// ================= REFRESH STUDENT COUNT =================
exports.refreshStudentCount = async (req, res) => {
  try {
    const { busId } = req.params;

    const bus = await Bus.findById(busId);
    if (!bus) {
      return res.status(404).json({ message: "Bus not found" });
    }

    const count = await Student.countDocuments({ busId: bus._id });
    bus.studentCount = count;
    await bus.save();

    res.status(200).json({
      message: "Student count refreshed successfully",
      bus,
    });
  } catch (err) {
    console.error("Refresh Student Count Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
};

// ================= GET UNASSIGNED DRIVERS =================
exports.getUnassignedDrivers = async (req, res) => {
  try {
    const { schoolId } = req.query;

    const filter = { busId: null };
    if (schoolId) filter.schoolId = schoolId;

    const drivers = await Driver.find(filter)
      .select("-password")
      .sort({ createdAt: -1 });

    res.status(200).json({
      message: "Unassigned drivers fetched successfully",
      drivers,
    });
  } catch (err) {
    console.error("Get Unassigned Drivers Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
};