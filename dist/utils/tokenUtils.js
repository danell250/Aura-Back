"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateMagicToken = generateMagicToken;
exports.hashToken = hashToken;
const crypto_1 = __importDefault(require("crypto"));
/**
 * Generates a cryptographically strong random hex string.
 * Used for magic links and other one-time tokens.
 */
function generateMagicToken() {
    return crypto_1.default.randomBytes(32).toString('hex');
}
/**
 * Hashes a token using SHA-256.
 * We store the hash in the DB, not the raw token.
 */
function hashToken(token) {
    return crypto_1.default
        .createHash('sha256')
        .update(token)
        .digest('hex');
}
