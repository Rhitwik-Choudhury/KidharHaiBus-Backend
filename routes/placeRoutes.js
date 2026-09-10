const express = require("express");
const rateLimit = require("express-rate-limit");
const auth = require("../middleware/authMiddleware");
const {
  autocompletePlaces,
  getPlaceDetails,
} = require("../controllers/placeController");

const router = express.Router();

const placeSearchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many location searches. Please wait a moment." },
});

router.use(auth, placeSearchLimiter);
router.post("/autocomplete", autocompletePlaces);
router.get("/:placeId", getPlaceDetails);

module.exports = router;
