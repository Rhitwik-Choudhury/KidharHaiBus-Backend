const admin = require("../config/firebase");

const sendNotification = async (token, title, body) => {
  if (!token) return;

  const message = {
    notification: {
      title,
      body,
    },
    token,
  };

  try {
    await admin.messaging().send(message);
    console.log("✅ Notification sent");
  } catch (error) {
    console.error("❌ FCM Error:", error);
  }
};

module.exports = sendNotification;