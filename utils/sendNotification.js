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

    const cleanToken = token.trim();
    const safeTitle = String(title);
    const safeBody = String(body);

    console.log("Sending FCM:", {
      tokenSuffix: cleanToken.slice(-12),
      title: safeTitle,
    });

    const message = {
      token: cleanToken,

      // Android displays this automatically while the app is
      // in the background or removed from recent apps.
      notification: {
        title: safeTitle,
        body: safeBody,
      },

      // Retain data for the existing foreground handler.
      data: {
        title: safeTitle,
        body: safeBody,
      },

      android: {
        priority: "high",
      },
    };

    const messageId = await admin.messaging().send(message);

    console.log("FCM accepted by Firebase:", {
      messageId,
      tokenSuffix: cleanToken.slice(-12),
      title: safeTitle,
    });
  } catch (err) {
    console.error("FCM Error:", {
      code: err.code,
      message: err.message,
      tokenSuffix:
        typeof token === "string"
          ? token.trim().slice(-12)
          : null,
    });
  }
};

module.exports = sendNotification;