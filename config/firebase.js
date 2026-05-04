let admin = null;

try {
  const firebaseConfig = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (firebaseConfig) {
    const serviceAccount = JSON.parse(firebaseConfig);

    admin = require("firebase-admin");

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    console.log("Firebase initialized");
  } else {
    console.log("Firebase not configured, skipping...");
  }
} catch (err) {
  console.log("Firebase init error:", err.message);
}

module.exports = admin;