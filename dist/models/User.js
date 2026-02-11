"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUsersCollection = exports.initializeUserCollection = void 0;
// This will be initialized when the database connection is established
let usersCollection;
const initializeUserCollection = (db) => __awaiter(void 0, void 0, void 0, function* () {
    usersCollection = db.collection('users');
    // Create unique index on email (case-insensitive)
    // This ensures that "JF2795584@gmail.com" and "jf2795584@gmail.com" are treated as the same
    // and prevents duplicate accounts with the same email.
    try {
        yield usersCollection.createIndex({ email: 1 }, {
            unique: true,
            collation: { locale: 'en', strength: 2 },
            background: true,
            name: 'email_unique_case_insensitive'
        });
        console.log("✅ User collection initialized with unique email index");
    }
    catch (error) {
        console.warn("⚠️  Warning: Could not create unique email index:", error);
    }
    // Create unique index on handle (case-insensitive)
    try {
        yield usersCollection.createIndex({ handle: 1 }, {
            unique: true,
            collation: { locale: 'en', strength: 2 },
            background: true,
            name: 'handle_unique_case_insensitive'
        });
    }
    catch (error) {
        console.warn("⚠️  Warning: Could not create unique handle index:", error);
    }
    // Create index on id for fast lookups
    try {
        yield usersCollection.createIndex({ id: 1 }, { unique: true, background: true });
    }
    catch (error) {
        console.warn("⚠️  Warning: Could not create id index:", error);
    }
});
exports.initializeUserCollection = initializeUserCollection;
const getUsersCollection = () => {
    if (!usersCollection) {
        throw new Error('Users collection not initialized. Call initializeUserCollection first.');
    }
    return usersCollection;
};
exports.getUsersCollection = getUsersCollection;
