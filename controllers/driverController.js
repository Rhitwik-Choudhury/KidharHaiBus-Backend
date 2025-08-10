const Driver = require('../models/Driver');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const FIXED_DRIVER_CODE = 'DRIVER2025'; // 🔒 Use this fixed code for now

// Signup Controller
exports.registerDriver = async (req, res) => {
  const { fullName, email, password, driverCode } = req.body;

  try {
    if (driverCode !== FIXED_DRIVER_CODE) {
      return res.status(403).json({ message: 'Invalid driver code' });
    }

    const existingDriver = await Driver.findOne({ email });
    if (existingDriver) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newDriver = new Driver({
      fullName,
      email,
      password: hashedPassword,
      driverCode,
    });

    await newDriver.save();

    const token = jwt.sign(
      { id: newDriver._id, role: 'driver' },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.status(201).json({
      message: 'Driver registered successfully',
      token,
      user: {
        id: newDriver._id,
        fullName: newDriver.fullName,
        email: newDriver.email,
        driverCode: newDriver.driverCode
      }
    });
  } catch (err) {
    console.error('Driver Register Error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
};

// Login Controller
exports.loginDriver = async (req, res) => {
  const { email, password } = req.body;

  try {
    const driver = await Driver.findOne({ email });
    if (!driver) {
      return res.status(400).json({ message: 'Driver not found' });
    }

    const isMatch = await bcrypt.compare(password, driver.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid password' });
    }

    const token = jwt.sign(
      { id: driver._id, role: 'driver' },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: driver._id,
        fullName: driver.fullName,
        email: driver.email,
        driverCode: driver.driverCode,
      },
    });
  } catch (err) {
    console.error('Driver Login Error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
};
