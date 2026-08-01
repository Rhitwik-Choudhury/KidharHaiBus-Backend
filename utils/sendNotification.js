const admin = require("../config/firebase");

const sendNotification = async (token, title, body) => {
  try {
    if (!admin) {
      console.log(
        "Firebase not initialized, skipping notification"
      );
      return;
    }

    if (
      !token ||
      typeof token !== "string" ||
      token.trim().length === 0
    ) {
      console.log("Invalid FCM token, skipping notification");
      return;
    }

    const message = {
      token: token.trim(),

      // Data-only payload. The mobile Notifee handler displays it.
      data: {
        title: String(title),
        body: String(body),
      },

      android: {
        priority: "high",
      },
    };

    await admin.messaging().send(message);

    console.log("FCM sent successfully");
  } catch (err) {
    console.error("FCM Error:", err.message);
  }
};

module.exports = sendNotification;