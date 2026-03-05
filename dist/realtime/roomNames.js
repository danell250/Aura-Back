"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCompanyApplicationRoom = void 0;
const crypto_1 = __importDefault(require("crypto"));
const ROOM_NAME_SALT = String(process.env.SOCKET_ROOM_SALT || process.env.JWT_SECRET || 'aura-room-salt').trim() ||
    'aura-room-salt';
const normalizeCompanyId = (companyId) => String(companyId || '').trim();
const getCompanyApplicationRoom = (companyId) => {
    const normalizedCompanyId = normalizeCompanyId(companyId);
    const digest = crypto_1.default
        .createHash('sha256')
        .update(`${ROOM_NAME_SALT}:${normalizedCompanyId}`)
        .digest('hex')
        .slice(0, 24);
    return `company-app-${digest}`;
};
exports.getCompanyApplicationRoom = getCompanyApplicationRoom;
