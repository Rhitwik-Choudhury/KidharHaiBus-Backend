const admin = require("../config/firebase");

const sendNotification = async (token, title, body, data = {}, options = {}) => {
  try {
    if (!admin) {
      console.log(
        "Firebase not initialized, skipping notification"
      );
      if (options.throwOnError) throw new Error('Firebase is not initialized');
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
        ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)])),
        title: safeTitle,
        body: safeBody,
      },

      android: {
        priority: "high",
      },
    };

    await admin.messaging().send(message);

  } catch (err) {
    if (options.throwOnError) {
      if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(err.code)) return;
      throw err;
    }
    console.error("FCM Error:", {
      code: err.code,
      message: err.message,
    });
  }
};

module.exports = sendNotification;
