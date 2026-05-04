const admin = require("../config/firebase");

const sendNotification = async (token, title, body) => {
  try {
    if (!admin) {
      console.log("Firebase not initialized");
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
    console.error("FCM Error:", err);
  }
};

module.exports = sendNotification;