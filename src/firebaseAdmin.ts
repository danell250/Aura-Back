import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

const isTestRuntime = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const hasServiceAccount = Boolean(projectId && clientEmail && privateKey);

if (!admin.apps.length && !isTestRuntime && hasServiceAccount) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
    console.log("✅ Firebase Admin initialized successfully");
  } catch (error) {
    console.error("❌ Firebase Admin initialization failed:", error);
  }
} else if (!isTestRuntime && !hasServiceAccount) {
  console.warn("⚠️ Firebase Admin not initialized: missing service account env vars.");
}

export default admin;
