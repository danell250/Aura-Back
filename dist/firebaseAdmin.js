"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const isTestRuntime = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = (_a = process.env.FIREBASE_PRIVATE_KEY) === null || _a === void 0 ? void 0 : _a.replace(/\\n/g, "\n");
const hasServiceAccount = Boolean(projectId && clientEmail && privateKey);
if (!firebase_admin_1.default.apps.length && !isTestRuntime && hasServiceAccount) {
    try {
        firebase_admin_1.default.initializeApp({
            credential: firebase_admin_1.default.credential.cert({
                projectId,
                clientEmail,
                privateKey,
            }),
        });
        console.log("✅ Firebase Admin initialized successfully");
    }
    catch (error) {
        console.error("❌ Firebase Admin initialization failed:", error);
    }
}
else if (!isTestRuntime && !hasServiceAccount) {
    console.warn("⚠️ Firebase Admin not initialized: missing service account env vars.");
}
exports.default = firebase_admin_1.default;
