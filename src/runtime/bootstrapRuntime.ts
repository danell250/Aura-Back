import type express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { parse as parseCookieHeader } from 'cookie';
import { verifyAccessToken } from '../utils/jwtUtils';
import { validateIdentityAccess } from '../utils/identityUtils';
import { registerSocketServer } from '../realtime/socketHub';
import { CallType, getCallLogsCollection } from '../models/CallLog';
import { connectDB, isDBConnected } from '../db';
import { migrateLegacyCompanies } from '../services/migrationService';
import { startRuntimeRecurringJobs } from './recurringJobs';

type HttpServerInstance = ReturnType<express.Application['listen']>;

type DatabaseRuntimeState = 'idle' | 'initializing' | 'ready' | 'failed';
type IdentityType = 'user' | 'company';
type SocketAck = (result: any) => void;
type AuthenticatedSocketUser = { id?: string };
type IdentityRoomFactory = (identityType: IdentityType, identityId: string) => string;
type JoinIdentityFn = (identityType: IdentityType, identityId: string) => string;
type SocketIdentityPayload = { identityType?: IdentityType; identityId?: string };
type SocketTypingPayload = {
  fromType?: IdentityType;
  fromId?: string;
  toType?: IdentityType;
  toId?: string;
};
type SocketCallPayload = {
  callId?: string;
  fromType?: IdentityType;
  fromId?: string;
  toType?: IdentityType;
  toId?: string;
  callType?: 'audio' | 'video';
  offer?: any;
  answer?: any;
  candidate?: any;
  reason?: string;
};
type SocketRuntimeConfig = {
  app: express.Application;
  server: HttpServerInstance;
  allowedOrigins: string[];
};

let databaseRuntimeState: DatabaseRuntimeState = 'idle';
let databaseRuntimeReadyPromise: Promise<'ready' | 'failed'> | null = null;
let resolveDatabaseRuntimeState: ((state: 'ready' | 'failed') => void) | null = null;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const beginDatabaseRuntimeInitialization = () => {
  databaseRuntimeState = 'initializing';
  databaseRuntimeReadyPromise = new Promise<'ready' | 'failed'>((resolve) => {
    resolveDatabaseRuntimeState = resolve;
  });
};

const completeDatabaseRuntimeInitialization = (state: 'ready' | 'failed') => {
  databaseRuntimeState = state;
  resolveDatabaseRuntimeState?.(state);
  resolveDatabaseRuntimeState = null;
};

const waitForDatabaseRuntimeInitialization = async (timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (isDBConnected()) {
      return true;
    }
    if (databaseRuntimeState === 'failed') {
      return false;
    }

    if (databaseRuntimeReadyPromise) {
      try {
        const waitResult = await Promise.race<'ready' | 'failed' | 'timeout'>([
          databaseRuntimeReadyPromise,
          new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 100)),
        ]);
        if (waitResult === 'ready') return true;
        if (waitResult === 'failed') return false;
      } catch {
        return false;
      }
    } else {
      await wait(100);
    }
  }

  return isDBConnected();
};

const waitForDatabaseRuntimeReadyOrFailure = async () => {
  return waitForDatabaseRuntimeInitialization(15000);
};

const registerRoomMembershipHandlers = ({
  socket,
  user,
  identityRooms,
  identityRoom,
  joinIdentity,
}: {
  socket: any;
  user?: AuthenticatedSocketUser;
  identityRooms: Set<string>;
  identityRoom: IdentityRoomFactory;
  joinIdentity: JoinIdentityFn;
}) => {
  socket.on('join_user_room', (userId: string, ack?: SocketAck) => {
    if (!user?.id) {
      ack?.({ success: false, error: 'Unauthorized user room' });
      return;
    }
    if (user.id === userId) {
      socket.join(userId);
      console.log(`🏠 User ${user.id} joined their private room`);
      ack?.({ success: true });
    } else {
      console.warn(`⚠️ User ${user?.id} tried to join room for ${userId}`);
      ack?.({ success: false, error: 'Unauthorized user room' });
    }
  });

  socket.on('join_company_room', async (companyId: string, ack?: SocketAck) => {
    if (!user?.id || typeof companyId !== 'string' || !companyId.trim()) {
      ack?.({ success: false, error: 'companyId is required' });
      return;
    }

    if (!isDBConnected()) {
      await waitForDatabaseRuntimeInitialization();
    }
    if (!isDBConnected()) {
      console.warn(`⚠️ join_company_room blocked while DB is unavailable for ${companyId}`);
      ack?.({ success: false, error: 'Database unavailable' });
      return;
    }

    try {
      const hasAccess = await validateIdentityAccess(user.id, companyId);
      if (!hasAccess) {
        console.warn(`⚠️ User ${user.id} denied join_company_room for ${companyId}`);
        ack?.({ success: false, error: 'Unauthorized company room' });
        return;
      }

      socket.join(`company_${companyId}`);
      joinIdentity('company', companyId);
      console.log(`🏢 User ${user.id} joined company room ${companyId}`);
      ack?.({ success: true });
    } catch (error) {
      console.error('Failed to join company room:', error);
      ack?.({ success: false, error: 'Failed to join company room' });
    }
  });

  socket.on('leave_user_room', (userId: string, ack?: SocketAck) => {
    if (typeof userId !== 'string' || !userId.trim()) {
      ack?.({ success: false, error: 'userId is required' });
      return;
    }
    if (user?.id !== userId) {
      ack?.({ success: false, error: 'Unauthorized room leave request' });
      return;
    }
    socket.leave(userId);
    ack?.({ success: true });
  });

  socket.on('leave_company_room', (companyId: string, ack?: SocketAck) => {
    if (!user?.id || typeof companyId !== 'string' || !companyId.trim()) {
      ack?.({ success: false, error: 'companyId is required' });
      return;
    }
    const companyIdentityRoom = identityRoom('company', companyId);
    if (!identityRooms.has(companyIdentityRoom)) {
      ack?.({ success: false, error: 'Room is not joined' });
      return;
    }
    socket.leave(`company_${companyId}`);
    identityRooms.delete(companyIdentityRoom);
    socket.leave(companyIdentityRoom);
    ack?.({ success: true });
  });

  socket.on('join_identity_room', async (payload: SocketIdentityPayload, ack?: SocketAck) => {
    const identityType = payload?.identityType;
    const identityId = payload?.identityId;
    if (!identityType || !identityId) {
      ack?.({ success: false, error: 'identityType and identityId are required' });
      return;
    }

    try {
      if (identityType === 'user' && identityId !== user?.id) {
        ack?.({ success: false, error: 'Unauthorized identity room' });
        return;
      }

      if (identityType === 'company') {
        if (!user?.id) {
          ack?.({ success: false, error: 'Unauthorized identity room' });
          return;
        }
        if (!isDBConnected()) {
          await waitForDatabaseRuntimeInitialization();
        }
        if (!isDBConnected()) {
          ack?.({ success: false, error: 'Database unavailable' });
          return;
        }
        const hasAccess = await validateIdentityAccess(user.id, identityId);
        if (!hasAccess) {
          ack?.({ success: false, error: 'Unauthorized identity room' });
          return;
        }
      }

      const room = joinIdentity(identityType, identityId);
      ack?.({ success: true, room });
    } catch (error) {
      console.error('Failed to join identity room:', error);
      ack?.({ success: false, error: 'Failed to join identity room' });
    }
  });

  socket.on('leave_identity_room', (payload: SocketIdentityPayload, ack?: SocketAck) => {
    const identityType = payload?.identityType;
    const identityId = payload?.identityId;
    if (!identityType || !identityId) {
      ack?.({ success: false, error: 'identityType and identityId are required' });
      return;
    }

    if (identityType === 'user' && identityId === user?.id) {
      ack?.({ success: true });
      return;
    }

    const room = identityRoom(identityType, identityId);
    identityRooms.delete(room);
    socket.leave(room);
    ack?.({ success: true });
  });
};

const registerTypingHandlers = ({
  io,
  socket,
  user,
  identityRooms,
  identityRoom,
}: {
  io: SocketIOServer;
  socket: any;
  user?: AuthenticatedSocketUser;
  identityRooms: Set<string>;
  identityRoom: IdentityRoomFactory;
}) => {
  const normalizeTypingPayload = (payload: SocketTypingPayload) => {
    const fromType = payload?.fromType;
    const fromId = typeof payload?.fromId === 'string' ? payload.fromId.trim() : '';
    const toType = payload?.toType;
    const toId = typeof payload?.toId === 'string' ? payload.toId.trim() : '';

    if (!fromType || !fromId || !toType || !toId) {
      return null;
    }

    return { fromType, fromId, toType, toId };
  };

  const routeTypingEvent = (eventName: 'typing:start' | 'typing:stop', payload: SocketTypingPayload) => {
    const typing = normalizeTypingPayload(payload);
    if (!typing) {
      return { typing: null, error: 'Invalid typing payload' as string };
    }

    const fromRoom = identityRoom(typing.fromType, typing.fromId);
    if (!identityRooms.has(fromRoom)) {
      console.warn(`⚠️ Blocked typing event from non-joined identity ${typing.fromType}:${typing.fromId}`);
      return { typing: null, error: 'Identity room is not joined' as string };
    }

    const targetRoom = identityRoom(typing.toType, typing.toId);
    io.to(targetRoom).emit(eventName, {
      fromType: typing.fromType,
      fromId: typing.fromId,
      toType: typing.toType,
      toId: typing.toId,
      fromUserId: user?.id,
      timestamp: Date.now(),
    });

    return { typing, error: null as string | null };
  };

  socket.on('typing:start', (payload: SocketTypingPayload, ack?: SocketAck) => {
    const { typing, error } = routeTypingEvent('typing:start', payload);
    if (!typing) {
      ack?.({ success: false, error: error || 'Unable to route typing start' });
      return;
    }
    ack?.({ success: true });
  });

  socket.on('typing:stop', (payload: SocketTypingPayload, ack?: SocketAck) => {
    const { typing, error } = routeTypingEvent('typing:stop', payload);
    if (!typing) {
      ack?.({ success: false, error: error || 'Unable to route typing stop' });
      return;
    }
    ack?.({ success: true });
  });
};

const registerCallHandlers = ({
  io,
  socket,
  user,
  identityRooms,
  identityRoom,
}: {
  io: SocketIOServer;
  socket: any;
  user?: AuthenticatedSocketUser;
  identityRooms: Set<string>;
  identityRoom: IdentityRoomFactory;
}) => {
  const ensureCallLogDatabaseReady = async () => {
    if (isDBConnected()) {
      return true;
    }
    await waitForDatabaseRuntimeInitialization();
    return isDBConnected();
  };

  const normalizeCallPayload = (payload: SocketCallPayload) => {
    const callId = typeof payload?.callId === 'string' ? payload.callId.trim() : '';
    const fromType = payload?.fromType;
    const fromId = typeof payload?.fromId === 'string' ? payload.fromId.trim() : '';
    const toType = payload?.toType;
    const toId = typeof payload?.toId === 'string' ? payload.toId.trim() : '';
    const callType: CallType = payload?.callType === 'video' ? 'video' : 'audio';

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

  const recordCallInvite = async (call: ReturnType<typeof normalizeCallPayload>) => {
    if (!call) return;
    if (!(await ensureCallLogDatabaseReady())) return;
    try {
      const now = new Date();
      await getCallLogsCollection().updateOne(
        { callId: call.callId },
        {
          $set: {
            callType: call.callType,
            fromType: call.fromType,
            fromId: call.fromId,
            toType: call.toType,
            toId: call.toId,
            initiatedByUserId: user?.id,
            status: 'ringing',
            updatedAt: now,
          },
          $setOnInsert: {
            callId: call.callId,
            startedAt: now,
            createdAt: now,
            seenBy: [],
          },
        },
        { upsert: true }
      );
    } catch (error) {
      console.error('Failed to record call invite:', error);
    }
  };

  const recordCallAccepted = async (call: ReturnType<typeof normalizeCallPayload>) => {
    if (!call) return;
    if (!(await ensureCallLogDatabaseReady())) return;
    try {
      const now = new Date();
      await getCallLogsCollection().updateOne(
        { callId: call.callId },
        {
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
            initiatedByUserId: user?.id,
          },
        },
        { upsert: true }
      );
    } catch (error) {
      console.error('Failed to record accepted call:', error);
    }
  };

  const recordCallRejected = async (call: ReturnType<typeof normalizeCallPayload>) => {
    if (!call) return;
    if (!(await ensureCallLogDatabaseReady())) return;
    try {
      const now = new Date();
      const reason = typeof call.reason === 'string' && call.reason.trim() ? call.reason.trim() : 'rejected';
      await getCallLogsCollection().updateOne(
        { callId: call.callId },
        {
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
            initiatedByUserId: user?.id,
          },
        },
        { upsert: true }
      );
    } catch (error) {
      console.error('Failed to record rejected call:', error);
    }
  };

  const recordCallEnded = async (call: ReturnType<typeof normalizeCallPayload>) => {
    if (!call) return;
    if (!(await ensureCallLogDatabaseReady())) return;
    try {
      const now = new Date();
      const callLogs = getCallLogsCollection();
      const existing = await callLogs.findOne({ callId: call.callId });
      const accepted = !!existing?.acceptedAt || existing?.status === 'accepted' || existing?.status === 'ended';
      const reason = typeof call.reason === 'string' && call.reason.trim() ? call.reason.trim() : 'ended';

      let status: 'ended' | 'missed' | 'cancelled' | 'failed' = 'ended';
      if (!accepted) {
        if (reason === 'no-answer' || reason === 'timeout') {
          status = 'missed';
        } else if (reason === 'cancelled') {
          status = 'cancelled';
        } else {
          status = 'missed';
        }
      } else if (reason === 'failed') {
        status = 'failed';
      }

      const connectedAt = existing?.acceptedAt || existing?.startedAt;
      const durationSeconds =
        accepted && connectedAt
          ? Math.max(0, Math.round((now.getTime() - new Date(connectedAt).getTime()) / 1000))
          : undefined;

      await callLogs.updateOne(
        { callId: call.callId },
        {
          $set: {
            callType: call.callType,
            fromType: call.fromType,
            fromId: call.fromId,
            toType: call.toType,
            toId: call.toId,
            status,
            endReason: reason,
            endedAt: now,
            ...(typeof durationSeconds === 'number' ? { durationSeconds } : {}),
            updatedAt: now,
          },
          $setOnInsert: {
            callId: call.callId,
            startedAt: now,
            createdAt: now,
            seenBy: [],
            initiatedByUserId: user?.id,
          },
        },
        { upsert: true }
      );
    } catch (error) {
      console.error('Failed to record ended call:', error);
    }
  };

  const routeCallEvent = (eventName: string, payload: SocketCallPayload) => {
    const call = normalizeCallPayload(payload);
    if (!call) {
      return { call: null, error: 'Invalid call payload' as string };
    }

    const fromRoom = identityRoom(call.fromType, call.fromId);
    if (!identityRooms.has(fromRoom)) {
      console.warn(`⚠️ Blocked call event from non-joined identity ${call.fromType}:${call.fromId}`);
      return { call: null, error: 'Identity room is not joined' as string };
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
      fromUserId: user?.id,
      timestamp: Date.now(),
    });

    return { call, error: null as string | null };
  };

  socket.on('call:invite', async (payload: SocketCallPayload, ack?: SocketAck) => {
    const { call, error } = routeCallEvent('call:incoming', payload);
    if (!call) {
      ack?.({ success: false, error: error || 'Unable to route call invite' });
      return;
    }
    await recordCallInvite(call);
    ack?.({ success: true });
  });

  socket.on('call:accept', async (payload: SocketCallPayload, ack?: SocketAck) => {
    const { call, error } = routeCallEvent('call:accepted', payload);
    if (!call) {
      ack?.({ success: false, error: error || 'Unable to route call accept' });
      return;
    }
    await recordCallAccepted(call);
    ack?.({ success: true });
  });

  socket.on('call:reject', async (payload: SocketCallPayload, ack?: SocketAck) => {
    const { call, error } = routeCallEvent('call:rejected', payload);
    if (!call) {
      ack?.({ success: false, error: error || 'Unable to route call reject' });
      return;
    }
    await recordCallRejected(call);
    ack?.({ success: true });
  });

  socket.on('call:ice-candidate', (payload: SocketCallPayload, ack?: SocketAck) => {
    const { call, error } = routeCallEvent('call:ice-candidate', payload);
    if (!call) {
      ack?.({ success: false, error: error || 'Unable to route ICE candidate' });
      return;
    }
    ack?.({ success: true });
  });

  socket.on('call:end', async (payload: SocketCallPayload, ack?: SocketAck) => {
    const { call, error } = routeCallEvent('call:ended', payload);
    if (!call) {
      ack?.({ success: false, error: error || 'Unable to route call end' });
      return;
    }
    await recordCallEnded(call);
    ack?.({ success: true });
  });
};

const registerRealtimeConnectionHandlers = (io: SocketIOServer) => {
  const identityRoom: IdentityRoomFactory = (identityType, identityId) => `identity:${identityType}:${identityId}`;

  io.on('connection', (socket) => {
    const user = (socket as any).user as AuthenticatedSocketUser | undefined;
    console.log(`🔌 Socket.IO client connected: ${socket.id} (User: ${user?.id})`);

    const identityRooms = new Set<string>();
    const joinIdentity: JoinIdentityFn = (identityType, identityId) => {
      const room = identityRoom(identityType, identityId);
      identityRooms.add(room);
      socket.join(room);
      return room;
    };

    if (user?.id) {
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

const normalizeSocketRuntimeConfig = (
  configOrServer: SocketRuntimeConfig | HttpServerInstance,
  legacyApp?: express.Application,
  legacyAllowedOrigins?: string[]
): SocketRuntimeConfig => {
  if (
    typeof configOrServer === 'object' &&
    configOrServer !== null &&
    'app' in (configOrServer as SocketRuntimeConfig) &&
    'server' in (configOrServer as SocketRuntimeConfig) &&
    'allowedOrigins' in (configOrServer as SocketRuntimeConfig)
  ) {
    return configOrServer as SocketRuntimeConfig;
  }

  if (legacyApp && legacyAllowedOrigins) {
    return {
      app: legacyApp,
      server: configOrServer as HttpServerInstance,
      allowedOrigins: legacyAllowedOrigins,
    };
  }

  throw new Error('initSocketRuntime requires { app, server, allowedOrigins }');
};

export function initSocketRuntime(config: SocketRuntimeConfig): void;
export function initSocketRuntime(
  server: HttpServerInstance,
  app: express.Application,
  allowedOrigins: string[]
): void;
export function initSocketRuntime(
  configOrServer: SocketRuntimeConfig | HttpServerInstance,
  legacyApp?: express.Application,
  legacyAllowedOrigins?: string[]
) {
  const { app, server, allowedOrigins } = normalizeSocketRuntimeConfig(
    configOrServer,
    legacyApp,
    legacyAllowedOrigins
  );
  const io = new SocketIOServer(server, {
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
  registerSocketServer(io);

  io.use(async (socket, next) => {
    if (!isDBConnected()) {
      const databaseReady = await waitForDatabaseRuntimeReadyOrFailure();
      if (!databaseReady) {
        return next(new Error('Service unavailable: database is not ready'));
      }
    }

    let token = socket.handshake.auth?.token;
    const cookieHeader = socket.handshake?.headers?.cookie;

    if (!token && cookieHeader) {
      const cookies = parseCookieHeader(cookieHeader);
      token = cookies.accessToken;
    }

    if (!token) {
      return next(new Error('Authentication error: Token missing'));
    }

    const decoded = verifyAccessToken(token);
    if (!decoded) {
      return next(new Error('Authentication error: Invalid token'));
    }

    (socket as any).user = decoded;
    next();
  });

  registerRealtimeConnectionHandlers(io);

};

export const initializeDatabaseRuntime = async ({
  loadDemoPostsIfEmpty,
  loadDemoAdsIfEmpty,
  onDatabaseReady,
}: {
  loadDemoPostsIfEmpty: () => Promise<void>;
  loadDemoAdsIfEmpty: () => Promise<void>;
  onDatabaseReady?: () => Promise<void> | void;
}) => {
  beginDatabaseRuntimeInitialization();
  console.log('🔄 Attempting database connection...');
  try {
    const db = await connectDB();
    const isProduction = process.env.NODE_ENV === 'production';

    if (!db) {
      if (isProduction) {
        throw new Error('Database connection is required in production.');
      }
      console.warn('⚠️  Database connection not available. Some features will be unavailable until DB reconnects.');
    } else {
      console.log('✅ Database connection established');
      await onDatabaseReady?.();

      const shouldLoadDemoData =
        process.env.NODE_ENV !== 'production' &&
        process.env.DISABLE_DEMO_BOOTSTRAP !== 'true';

      if (shouldLoadDemoData) {
        await loadDemoPostsIfEmpty();
        await loadDemoAdsIfEmpty();
      }

      await migrateLegacyCompanies();
    }
    completeDatabaseRuntimeInitialization('ready');
  } catch (error) {
    completeDatabaseRuntimeInitialization('failed');
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
};

export const startRecurringRuntimeJobs = () => {
  startRuntimeRecurringJobs();
};

export const registerGracefulShutdownHandlers = (server: HttpServerInstance) => {
  const gracefulShutdown = (signal: string) => {
    console.log(`\\n🔄 Received ${signal}. Shutting down gracefully...`);
    server.close(async () => {
      console.log('✅ HTTP server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
};
