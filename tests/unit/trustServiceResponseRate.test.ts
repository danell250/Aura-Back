import { calculateResponseRate } from '../../src/services/trustService';

const createDirectMessage = ({
  senderId,
  receiverId,
  timestamp,
}: {
  senderId: string;
  receiverId: string;
  timestamp: number;
}) => ({
  senderOwnerType: 'user',
  senderOwnerId: senderId,
  receiverOwnerType: 'user',
  receiverOwnerId: receiverId,
  timestamp,
});

describe('calculateResponseRate', () => {
  test('counts trailing unanswered incoming turns in the ratio', () => {
    const messages = [
      createDirectMessage({ senderId: 'user-2', receiverId: 'user-1', timestamp: 1000 }),
      createDirectMessage({ senderId: 'user-1', receiverId: 'user-2', timestamp: 2000 }),
      createDirectMessage({ senderId: 'user-2', receiverId: 'user-1', timestamp: 3000 }),
      createDirectMessage({ senderId: 'user-2', receiverId: 'user-1', timestamp: 4000 }),
    ];

    expect(calculateResponseRate(messages, 'user-1')).toBe(7);
  });

  test('treats multiple incoming messages before a reply as a single responded turn', () => {
    const messages = [
      createDirectMessage({ senderId: 'user-2', receiverId: 'user-1', timestamp: 1000 }),
      createDirectMessage({ senderId: 'user-2', receiverId: 'user-1', timestamp: 1500 }),
      createDirectMessage({ senderId: 'user-1', receiverId: 'user-2', timestamp: 2500 }),
    ];

    expect(calculateResponseRate(messages, 'user-1')).toBe(10);
  });
});
