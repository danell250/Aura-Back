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
exports.registerGracefulShutdownHandlers = exports.startRecurringRuntimeJobs = exports.initializeDatabaseRuntime = void 0;
exports.initSocketRuntime = initSocketRuntime;
const socket_io_1 = require("socket.io");
const cookie_1 = require("cookie");
const jwtUtils_1 = require("../utils/jwtUtils");
const identityUtils_1 = require("../utils/identityUtils");
const socketHub_1 = require("../realtime/socketHub");
const CallLog_1 = require("../models/CallLog");
const db_1 = require("../db");
const migrationService_1 = require("../services/migrationService");
const recurringJobs_1 = require("./recurringJobs");
let databaseRuntimeState = 'idle';
let databaseRuntimeReadyPromise = null;
let resolveDatabaseRuntimeState = null;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const beginDatabaseRuntimeInitialization = () => {
    databaseRuntimeState = 'initializing';
    databaseRuntimeReadyPromise = new Promise((resolve) => {
        resolveDatabaseRuntimeState = resolve;
    });
};
const completeDatabaseRuntimeInitialization = (state) => {
    databaseRuntimeState = state;
    resolveDatabaseRuntimeState === null || resolveDatabaseRuntimeState === void 0 ? void 0 : resolveDatabaseRuntimeState(state);
    resolveDatabaseRuntimeState = null;
};
const waitForDatabaseRuntimeInitialization = (...args_1) => __awaiter(void 0, [...args_1], void 0, function* (timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if ((0, db_1.isDBConnected)()) {
            return true;
        }
        if (databaseRuntimeState === 'failed') {
            return false;
        }
        if (databaseRuntimeReadyPromise) {
            try {
                const waitResult = yield Promise.race([
                    databaseRuntimeReadyPromise,
                    new Promise((resolve) => setTimeout(() => resolve('timeout'), 100)),
                ]);
                if (waitResult === 'ready')
                    return true;
                if (waitResult === 'failed')
                    return false;
            }
            catch (_a) {
                return false;
            }
        }
        else {
            yield wait(100);
        }
    }
    return (0, db_1.isDBConnected)();
});
const waitForDatabaseRuntimeReadyOrFailure = () => __awaiter(void 0, void 0, void 0, function* () {
    return waitForDatabaseRuntimeInitialization(15000);
});
const registerRoomMembershipHandlers = ({ socket, user, identityRooms, identityRoom, joinIdentity, }) => {
    socket.on('join_user_room', (userId, ack) => {
        if (!(user === null || user === void 0 ? void 0 : user.id)) {
            ack === null || ack === void 0 ? void 0 : ack({ success: false, error: 'Unauthorized user room' });
            return;
        }
        if (user.id === userId) {
            socket.join(userId);
            console.log(`🏠 User ${user.id} joined their private room`);
            ack === null || ack === void 0 ? void 0 : ack({ success: true });
        }
        else {
            console.warn(`⚠️ User ${user === null || user === void 0 ? void 0 : user.id} tried to join room for ${userId}`);
            ack === null || ack === void 0 ? void 0 : ack({ success: false, error: 'Unauthorized user room' });
        }
    });
    socket.on('join_company_room', (companyId, ack) => __awaiter(void 0, void 0, void 0, function* () {
        if (!(user === null || user === void 0 ? void 0 : user.id) || typeof companyId !== 'string' || !companyId.trim()) {
            ack === null || ack === void 0 ? void 0 : ack({ success: false, error: 'companyId is required' });
            return;
        }
        if (!(0, db_1.isDBConnected)()) {
            yield waitForDatabaseRuntimeInitialization();
        }
        if (!(0, db_1.isDBConnected)()) {
            console.warn(`⚠️ join_company_room blocked while DB is unavailable for ${companyId}`);
            ack === null || ack === void 0 ? void 0 : ack({ success: false, error: 'Database unavailable' });
            return;
        }
        try {
            const hasAccess = yield (0, identityUtils_1.validateIdentityAccess)(user.id, companyId);
            if (!hasAccess) {
                console.warn(`⚠️ User ${user.id} denied join_company_room for ${companyId}`);
                ack === null || ack === void 0 ? void 0 : ack({ success: false, error: 'Unauthorized company room' });
                return;
            }
            socket.join(`company_${companyId}`);
            joinIdentity('company', companyId);
            console.log(`🏢 User ${user.id} joined company room ${companyId}`);
            ack === null || ack === void 0 ? void 0 : ack({ success: true });
        }
        catch (error) {
            console.error('Failed to join company room:', error);
            ack === null || ack === void 0 ? void 0 : ack({ success: false, error: 'Failed to join company room' });
        }
    }));
    socket.on('leave_user_room', (userId, ack) => {
        if (typeof userId !== 'string' || !userId.trim()) {
            ack === null || ack === void 0 ? void 0 : ack({ success: false, error: 'userId is required' });
            return;
        }
        if ((user === null || user === void 0 ? void 0 : user.id) !== userId) {
            ack === null || ack === void 0 ? void 0 : ack({ success: false, error: 'Unauthorized room leave request' });
            return;
        }
        socket.leave(userId);
        ack === null || ack === void 0 ? void 0 : ack({ success: true });
    });
    socket.on('leave_company_room', (companyId, ack) => {
        if (!(user === null || user === void 0 ? void 0 : user.id) || typeof companyId !== 'string' || !companyId.trim()) {
            ack === null || ack === void 0 ? void 0 : ack({ success: false, error: 'companyId is required' });
            return;
        }
        const companyIdentityRoom = identityRoom('company', companyId);
        if (!identityRooms.has(companyIdentityRoom)) {
            ack === null || ack === void 0 ? void 0 : ack({ success: false, error: 'Room is not joined' });
            return;
        }
        socket.leave(`company_${companyId}`);
        identityRooms.delete(companyIdentityRoom);
        socket.leave(companyIdentityRoom);
        ack === null || ack === void 0 ? void 0 : ack({ success: true });
    });
    socket.on('join_identity_room', (payload, ack) => __awaiter(void 0, void 0, void 0, function* () {
        const identityType = payload === null || payload === void 0 ? void 0 : payload.identityType;
        const identityId = payload === null || payload === void 0 ? void 0 : payload.identityId;
        if (!identityType || !identityId) {
            ack === null || ack === void 0 ? void 0 : ack({ success: false, error: 'identityType and identityId are required' });
            return;
        }
        try {
            if (identityType === 'user' && identityId !== (user === null || user === void 0 ? void 0 : user.id)) {
                ack === null || ack === void 0 ? void 0 : ack({ success: false, error: 'Unauthorized identity room' });
                return;
            }
            if (identityType === 'company') {
                if (!(user === null || user === void 0 ? void 0 : user.id)) {
                    ack === null || ack === void 0 ? void 0 : ack({ success: false, error: 'Unauthorized identity room' });
                    return;
                }
                if (!(0, db_1.isDBConnected)()) {
                    yield waitForDatabaseRuntimeInitialization();
                }
                if (!(0, db_1.isDBConnected)()) {
                    ack === null || ack === void 0 ? void 0 : ack({ success: false, error: 'Database unavailable' });
                    return;
                }
                const hasAccess = yield (0, identityUtils_1.validateIdentityAccess)(user.id, identityId);
                if (!hasAccess) {
                    ack === null || ack === void 0 ? void 0 : ack({ success: false, error: 'Unauthorized identity room' });
                    return;
                }
            }
            const room = joinIdentity(identityType, identityId);
            ack === null || ack === void 0 ? void 0 : ack({ success: true, room });
        }
        catch (error) {
            console.error('Failed to join identity room:', error);
            ack === null || ack === void 0 ? void 0 : ack({ success: false, error: 'Failed to join identity room' });
        }
    }));
    socket.on('leave_identity_room', (payload, ack) => {
        const identityType = payload === null || payload === void 0 ? void 0 : payload.identityType;
        const identityId = payload === null || payload === void 0 ? void 0 : payload.identityId;
        if (!identityType || !identityId) {
            ack === null || ack === void 0 ? void 0 : ack({ success: false, error: 'identityType and identityId are required' });
            return;
        }
        if (identityType === 'user' && identityId === (user === null || user === void 0 ? void 0 : user.id)) {
            ack === null || ack === void 0 ? void 0 : ack({ success: true });
            return;
        }
        const room = identityRoom(identityType, identityId);
        identityRooms.delete(room);
        socket.leave(room);
        ack === null || ack === void 0 ? void 0 : ack({ success: true });
    });
};
const registerTypingHandlers = ({ io, socket, user, identityRooms, identityRoom, }) => {
    const normalizeTypingPayload = (payload) => {
        const fromType = payload === null || payload === void 0 ? void 0 : payload.fromType;
        const fromId = typeof (payload === null || payload === void 0 ? void 0 : payload.fromId) === 'string' ? payload.fromId.trim() : '';
        const toType = payload === null || payload === void 0 ? void 0 : payload.toType;
        const toId = typeof (payload === null || payload === void 0 ? void 0 : payload.toId) === 'string' ? payload.toId.trim() : '';
        if (!fromType || !fromId || !toType || !toId) {
            return null;
        }
        return { fromType, fromId, toType, toId };
    };
    const routeTypingEvent = (eventName, payload) => {
        const typing = normalizeTypingPayload(payload);
        if (!typing) {
            return { typing: null, error: 'Invalid typing payload' };
        }
        const fromRoom = identityRoom(typing.fromType, typing.fromId);
        if (!identityRooms.has(fromRoom)) {
            console.warn(`⚠️ Blocked typing event from non-joined identity ${typing.fromType}:${typing.fromId}`);
            return { typing: null, error: 'Identity room is not joined' };
        }
        const targetRoom = identityRoom(typing.toType, typing.toId);
        io.to(targetRoom).emit(eventName, {
            fromType: typing.fromType,
            fromId: typing.fromId,
            toType: typing.toType,
            toId: typing.toId,
            fromUserId: user === null || user === void 0 ? void 0 : user.id,
            timestamp: Date.now(),
        });
        return { typing, error: null };
    };
    socket.on('typing:start', (payload, ack) => {
        const { typing, error } = routeTypingEvent('typing:start', payload);
        if (!typing) {
            ack === null || ack === void 0 ? void 0 : ack({ success: false, error: error || 'Unable to route typing start' });
            return;
        }
        ack === null || ack === void 0 ? void 0 : ack({ success: true });
    });
    socket.on('typing:stop', (payload, ack) => {
        const { typing, error } = routeTypingEvent('typing:stop', payload);
        if (!typing) {
            ack === null || ack === void 0 ? void 0 : ack({ success: false, error: error || 'Unable to route typing stop' });
            return;
        }
        ack === null || ack === void 0 ? void 0 : ack({ success: true });
    });
};
const registerCallHandlers = ({ io, socket, user, identityRooms, identityRoom, }) => {
    const ensureCallLogDatabaseReady = () => __awaiter(void 0, void 0, void 0, function* () {
        if ((0, db_1.isDBConnected)()) {
            return true;
        }
        yield waitForDatabaseRuntimeInitialization();
        return (0, db_1.isDBConnected)();
    });
    const normalizeCallPayload = (payload) => {
        const callId = typeof (payload === null || payload === void 0 ? void 0 : payload.callId) === 'string' ? payload.callId.trim() : '';
        const fromType = payload === null || payload === void 0 ? void 0 : payload.fromType;
        const fromId = typeof (payload === null || payload === void 0 ? void 0 : payload.fromId) === 'string' ? payload.fromId.trim() : '';
        const toType = payload === null || payload === void 0 ? void 0 : payload.toType;
        const toId = typeof (payload === null || payload === void 0 ? void 0 : payload.toId) === 'string' ? payload.toId.trim() : '';
        const callType = (payload === null || payload === void 0 ? void 0 : payload.callType) === 'video' ? 'video' : 'audio';
        if (!callId || !fromType || !fromId || !toType || !toId) {
            return null;
        }
        return {
            callId,
            fromType,
            fromId,
            toType,
            toId,
            callType,
            offer: payload.offer,
            answer: payload.answer,
            candidate: payload.candidate,
            reason: payload.reason,
        };
    };
    const recordCallInvite = (call) => __awaiter(void 0, void 0, void 0, function* () {
        if (!call)
            return;
        if (!(yield ensureCallLogDatabaseReady()))
            return;
        try {
            const now = new Date();
            yield (0, CallLog_1.getCallLogsCollection)().updateOne({ callId: call.callId }, {
                $set: {
                    callType: call.callType,
                    fromType: call.fromType,
                    fromId: call.fromId,
                    toType: call.toType,
                    toId: call.toId,
                    initiatedByUserId: user === null || user === void 0 ? void 0 : user.id,
                    status: 'ringing',
                    updatedAt: now,
                },
                $setOnInsert: {
                    callId: call.callId,
                    startedAt: now,
                    createdAt: now,
                    seenBy: [],
                },
            }, { upsert: true });
        }
        catch (error) {
            console.error('Failed to record call invite:', error);
        }
    });
    const recordCallAccepted = (call) => __awaiter(void 0, void 0, void 0, function* () {
        if (!call)
            return;
        if (!(yield ensureCallLogDatabaseReady()))
            return;
        try {
            const now = new Date();
            yield (0, CallLog_1.getCallLogsCollection)().updateOne({ callId: call.callId }, {
                $set: {
                    callType: call.callType,
                    fromType: call.fromType,
                    fromId: call.fromId,
                    toType: call.toType,
                    toId: call.toId,
                    status: 'accepted',
                    acceptedAt: now,
                    updatedAt: now,
                },
                $setOnInsert: {
                    callId: call.callId,
                    startedAt: now,
                    createdAt: now,
                    seenBy: [],
                    initiatedByUserId: user === null || user === void 0 ? void 0 : user.id,
                },
            }, { upsert: true });
        }
        catch (error) {
            console.error('Failed to record accepted call:', error);
        }
    });
    const recordCallRejected = (call) => __awaiter(void 0, void 0, void 0, function* () {
        if (!call)
            return;
        if (!(yield ensureCallLogDatabaseReady()))
            return;
        try {
            const now = new Date();
            const reason = typeof call.reason === 'string' && call.reason.trim() ? call.reason.trim() : 'rejected';
            yield (0, CallLog_1.getCallLogsCollection)().updateOne({ callId: call.callId }, {
                $set: {
                    callType: call.callType,
                    fromType: call.fromType,
                    fromId: call.fromId,
                    toType: call.toType,
                    toId: call.toId,
                    status: reason === 'busy' ? 'missed' : 'rejected',
                    endReason: reason,
                    endedAt: now,
                    updatedAt: now,
                },
                $setOnInsert: {
                    callId: call.callId,
                    startedAt: now,
                    createdAt: now,
                    seenBy: [],
                    initiatedByUserId: user === null || user === void 0 ? void 0 : user.id,
                },
            }, { upsert: true });
        }
        catch (error) {
            console.error('Failed to record rejected call:', error);
        }
    });
    const recordCallEnded = (call) => __awaiter(void 0, void 0, void 0, function* () {
        if (!call)
            return;
        if (!(yield ensureCallLogDatabaseReady()))
            return;
        try {
            const now = new Date();
            const callLogs = (0, CallLog_1.getCallLogsCollection)();
            const existing = yield callLogs.findOne({ callId: call.callId });
            const accepted = !!(existing === null || existing === void 0 ? void 0 : existing.acceptedAt) || (existing === null || existing === void 0 ? void 0 : existing.status) === 'accepted' || (existing === null || existing === void 0 ? void 0 : existing.status) === 'ended';
            const reason = typeof call.reason === 'string' && call.reason.trim() ? call.reason.trim() : 'ended';
            let status = 'ended';
            if (!accepted) {
                if (reason === 'no-answer' || reason === 'timeout') {
                    status = 'missed';
                }
                else if (reason === 'cancelled') {
                    status = 'cancelled';
                }
                else {
                    status = 'missed';
                }
            }
            else if (reason === 'failed') {
                status = 'failed';
            }
            const connectedAt = (existing === null || existing === void 0 ? void 0 : existing.acceptedAt) || (existing === null || existing === void 0 ? void 0 : existing.startedAt);
            const durationSeconds = accepted && connectedAt
                ? Math.max(0, Math.round((now.getTime() - new Date(connectedAt).getTime()) / 1000))
                : undefined;
            yield callLogs.updateOne({ callId: call.callId }, {
                $set: Object.assign(Object.assign({ callType: call.callType, fromType: call.fromType, fromId: call.fromId, toType: call.toType, toId: call.toId, status, endReason: reason, endedAt: now }, (typeof durationSeconds === 'number' ? { durationSeconds } : {})), { updatedAt: now }),
                $setOnInsert: {
                    callId: call.callId,
                    startedAt: now,
                    createdAt: now,
                    seenBy: [],
                    initiatedByUserId: user === null || user === void 0 ? void 0 : user.id,
                },
            }, { upsert: true });
        }
        catch (error) {
            console.error('Failed to record ended call:', error);
        }
    });
    const routeCallEvent = (eventName, payload) => {
        const call = normalizeCallPayload(payload);
        if (!call) {
            return { call: null, error: 'Invalid call payload' };
        }
        const fromRoom = identityRoom(call.fromType, call.fromId);
        if (!identityRooms.has(fromRoom)) {
            console.warn(`⚠️ Blocked call event from non-joined identity ${call.fromType}:${call.fromId}`);
            return { call: null, error: 'Identity room is not joined' };
        }
        const targetRoom = identityRoom(call.toType, call.toId);
        io.to(targetRoom).emit(eventName, {
            callId: call.callId,
            fromType: call.fromType,
            fromId: call.fromId,
            toType: call.toType,
            toId: call.toId,
            callType: call.callType,
            offer: call.offer,
            answer: call.answer,
            candidate: call.candidate,
            reason: call.reason,
            fromUserId: user === null || user === void 0 ? void 0 : user.id,
            timestamp: Date.now(),
        });
        return { call, error: null };
    };
    socket.on('call:invite', (payload, ack) => __awaiter(void 0, void 0, void 0, function* () {
        const { call, error } = routeCallEvent('call:incoming', payload);
        if (!call) {
            ack === null || ack === void 0 ? void 0 : ack({ success: false, error: error || 'Unable to route call invite' });
            return;
        }
        yield recordCallInvite(call);
        ack === null || ack === void 0 ? void 0 : ack({ success: true });
    }));
    socket.on('call:accept', (payload, ack) => __awaiter(void 0, void 0, void 0, function* () {
        const { call, error } = routeCallEvent('call:accepted', payload);
        if (!call) {
            ack === null || ack === void 0 ? void 0 : ack({ success: false, error: error || 'Unable to route call accept' });
            return;
        }
        yield recordCallAccepted(call);
        ack === null || ack === void 0 ? void 0 : ack({ success: true });
    }));
    socket.on('call:reject', (payload, ack) => __awaiter(void 0, void 0, void 0, function* () {
        const { call, error } = routeCallEvent('call:rejected', payload);
        if (!call) {
            ack === null || ack === void 0 ? void 0 : ack({ success: false, error: error || 'Unable to route call reject' });
            return;
        }
        yield recordCallRejected(call);
        ack === null || ack === void 0 ? void 0 : ack({ success: true });
    }));
    socket.on('call:ice-candidate', (payload, ack) => {
        const { call, error } = routeCallEvent('call:ice-candidate', payload);
        if (!call) {
            ack === null || ack === void 0 ? void 0 : ack({ success: false, error: error || 'Unable to route ICE candidate' });
            return;
        }
        ack === null || ack === void 0 ? void 0 : ack({ success: true });
    });
    socket.on('call:end', (payload, ack) => __awaiter(void 0, void 0, void 0, function* () {
        const { call, error } = routeCallEvent('call:ended', payload);
        if (!call) {
            ack === null || ack === void 0 ? void 0 : ack({ success: false, error: error || 'Unable to route call end' });
            return;
        }
        yield recordCallEnded(call);
        ack === null || ack === void 0 ? void 0 : ack({ success: true });
    }));
};
const registerRealtimeConnectionHandlers = (io) => {
    const identityRoom = (identityType, identityId) => `identity:${identityType}:${identityId}`;
    io.on('connection', (socket) => {
        const user = socket.user;
        console.log(`🔌 Socket.IO client connected: ${socket.id} (User: ${user === null || user === void 0 ? void 0 : user.id})`);
        const identityRooms = new Set();
        const joinIdentity = (identityType, identityId) => {
            const room = identityRoom(identityType, identityId);
            identityRooms.add(room);
            socket.join(room);
            return room;
        };
        if (user === null || user === void 0 ? void 0 : user.id) {
            joinIdentity('user', user.id);
        }
        registerRoomMembershipHandlers({ socket, user, identityRooms, identityRoom, joinIdentity });
        registerTypingHandlers({ io, socket, user, identityRooms, identityRoom });
        registerCallHandlers({ io, socket, user, identityRooms, identityRoom });
        socket.on('disconnect', () => {
            console.log('❌ Socket.IO client disconnected', socket.id);
        });
    });
};
const normalizeSocketRuntimeConfig = (configOrServer, legacyApp, legacyAllowedOrigins) => {
    if (typeof configOrServer === 'object' &&
        configOrServer !== null &&
        'app' in configOrServer &&
        'server' in configOrServer &&
        'allowedOrigins' in configOrServer) {
        return configOrServer;
    }
    if (legacyApp && legacyAllowedOrigins) {
        return {
            app: legacyApp,
            server: configOrServer,
            allowedOrigins: legacyAllowedOrigins,
        };
    }
    throw new Error('initSocketRuntime requires { app, server, allowedOrigins }');
};
function initSocketRuntime(configOrServer, legacyApp, legacyAllowedOrigins) {
    const { app, server, allowedOrigins } = normalizeSocketRuntimeConfig(configOrServer, legacyApp, legacyAllowedOrigins);
    const io = new socket_io_1.Server(server, {
        cors: {
            origin: allowedOrigins,
            credentials: true,
            methods: ['GET', 'POST'],
        },
        transports: ['websocket', 'polling'],
        path: '/socket.io/',
        pingInterval: 25000,
        pingTimeout: 20000,
    });
    app.set('io', io);
    (0, socketHub_1.registerSocketServer)(io);
    io.use((socket, next) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        if (!(0, db_1.isDBConnected)()) {
            const databaseReady = yield waitForDatabaseRuntimeReadyOrFailure();
            if (!databaseReady) {
                return next(new Error('Service unavailable: database is not ready'));
            }
        }
        let token = (_a = socket.handshake.auth) === null || _a === void 0 ? void 0 : _a.token;
        const cookieHeader = (_c = (_b = socket.handshake) === null || _b === void 0 ? void 0 : _b.headers) === null || _c === void 0 ? void 0 : _c.cookie;
        if (!token && cookieHeader) {
            const cookies = (0, cookie_1.parse)(cookieHeader);
            token = cookies.accessToken;
        }
        if (!token) {
            return next(new Error('Authentication error: Token missing'));
        }
        const decoded = (0, jwtUtils_1.verifyAccessToken)(token);
        if (!decoded) {
            return next(new Error('Authentication error: Invalid token'));
        }
        socket.user = decoded;
        next();
    }));
    registerRealtimeConnectionHandlers(io);
}
;
const initializeDatabaseRuntime = (_a) => __awaiter(void 0, [_a], void 0, function* ({ loadDemoPostsIfEmpty, loadDemoAdsIfEmpty, onDatabaseReady, }) {
    beginDatabaseRuntimeInitialization();
    console.log('🔄 Attempting database connection...');
    try {
        const db = yield (0, db_1.connectDB)();
        const isProduction = process.env.NODE_ENV === 'production';
        if (!db) {
            if (isProduction) {
                throw new Error('Database connection is required in production.');
            }
            console.warn('⚠️  Database connection not available. Some features will be unavailable until DB reconnects.');
        }
        else {
            console.log('✅ Database connection established');
            yield (onDatabaseReady === null || onDatabaseReady === void 0 ? void 0 : onDatabaseReady());
            const shouldLoadDemoData = process.env.NODE_ENV !== 'production' &&
                process.env.DISABLE_DEMO_BOOTSTRAP !== 'true';
            if (shouldLoadDemoData) {
                yield loadDemoPostsIfEmpty();
                yield loadDemoAdsIfEmpty();
            }
            yield (0, migrationService_1.migrateLegacyCompanies)();
        }
        completeDatabaseRuntimeInitialization('ready');
    }
    catch (error) {
        completeDatabaseRuntimeInitialization('failed');
        console.error('❌ Database initialization failed:', error);
        throw error;
    }
});
exports.initializeDatabaseRuntime = initializeDatabaseRuntime;
const startRecurringRuntimeJobs = () => {
    (0, recurringJobs_1.startRuntimeRecurringJobs)();
};
exports.startRecurringRuntimeJobs = startRecurringRuntimeJobs;
const registerGracefulShutdownHandlers = (server) => {
    const gracefulShutdown = (signal) => {
        console.log(`\\n🔄 Received ${signal}. Shutting down gracefully...`);
        server.close(() => __awaiter(void 0, void 0, void 0, function* () {
            console.log('✅ HTTP server closed');
            process.exit(0);
        }));
    };
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
};
exports.registerGracefulShutdownHandlers = registerGracefulShutdownHandlers;
