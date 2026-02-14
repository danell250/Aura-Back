import { Server as SocketIOServer } from 'socket.io';

let socketServer: SocketIOServer | null = null;

const identityRoom = (identityType: 'user' | 'company', identityId: string) =>
  `identity:${identityType}:${identityId}`;

export const registerSocketServer = (io: SocketIOServer) => {
  socketServer = io;
};

export const getSocketServer = () => socketServer;

export const emitToIdentity = (
  identityType: 'user' | 'company',
  identityId: string,
  event: string,
  payload: unknown,
) => {
  if (!socketServer || !identityId) return;
  socketServer.to(identityRoom(identityType, identityId)).emit(event, payload);
};
