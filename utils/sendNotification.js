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

    const safeTitle = String(title);
    const safeBody = String(body);

    const message = {
      token: token.trim(),

      // Android displays this automatically when the app is
      // in the background or closed.
      notification: {
        title: safeTitle,
        body: safeBody,
      },

      // Existing foreground code can continue reading these.
      data: {
        title: safeTitle,
        body: safeBody,
      },

      android: {
        priority: "high",
        notification: {
          channelId: "default",
          sound: "default",
        },
      },
    };

    const messageId = await admin.messaging().send(message);

    console.log("FCM sent successfully:", messageId);
  } catch (err) {
    console.error("FCM Error:", err.code || err.message);
  }
};

module.exports = sendNotification;