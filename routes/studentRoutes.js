const express = require("express");
const router = express.Router();
router.use(require("../middleware/authMiddleware"), require("../services/routeValidation").role("school"));

const {
  createStudent,
  getStudents,
  updateStudent,
  deleteStudent,
} = require("../controllers/studentController");

router.post("/", createStudent);
router.get("/", getStudents);
router.put("/:id", updateStudent);
router.delete("/:id", deleteStudent);

module.exports = router;