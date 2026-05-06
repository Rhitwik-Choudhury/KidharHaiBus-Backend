const admin = require("../config/firebase");

const sendNotification = async (token, title, body) => {
  try {
    // 🔥 SAFETY CHECK 1: Firebase init
    if (!admin) {
      console.log("⚠️ Firebase not initialized, skipping notification");
      return;
    }

    // 🔥 Accept both Expo + Firebase tokens (for now)
    if (!token || typeof token !== "string") {
      console.log("⚠️ Invalid token, skipping:", token);
      return;
    }

    const message = {
      token: token,
      notification: {
        title: title,
        body: body,
      },
      android: {
        priority: "high",
      },
      data: {
        title,
        body,
      },
    };

    await admin.messaging().send(message);

    console.log("FCM sent successfully");
  } catch (err) {
    console.error("❌ FCM Error:", err.message);
  }
};

module.exports = sendNotification;