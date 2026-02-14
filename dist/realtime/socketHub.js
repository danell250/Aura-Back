"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emitToIdentity = exports.getSocketServer = exports.registerSocketServer = void 0;
let socketServer = null;
const identityRoom = (identityType, identityId) => `identity:${identityType}:${identityId}`;
const registerSocketServer = (io) => {
    socketServer = io;
};
exports.registerSocketServer = registerSocketServer;
const getSocketServer = () => socketServer;
exports.getSocketServer = getSocketServer;
const emitToIdentity = (identityType, identityId, event, payload) => {
    if (!socketServer || !identityId)
        return;
    socketServer.to(identityRoom(identityType, identityId)).emit(event, payload);
};
exports.emitToIdentity = emitToIdentity;
