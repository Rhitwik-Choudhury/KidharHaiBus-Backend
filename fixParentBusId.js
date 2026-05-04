const mongoose = require("mongoose");
require("dotenv").config();

const Parent = require("./models/Parent");
const Student = require("./models/Student");

async function fixBusId() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB Connected");

    const parents = await Parent.find();

    for (let parent of parents) {
      if (parent.children && parent.children.length > 0) {
        const student = await Student.findById(parent.children[0]);

        if (student && student.busId) {
          parent.busId = student.busId;
          await parent.save();
          console.log(`✅ Updated parent ${parent._id}`);
        }
      }
    }

    console.log("🎉 DONE");
    process.exit();
  } catch (err) {
    console.error(err);
  }
}

fixBusId();