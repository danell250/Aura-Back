import { usersController } from '../../src/controllers/usersController';
import { getDB } from '../../src/db';

jest.mock('../../src/db', () => ({
  getDB: jest.fn(),
}));

const mockedGetDB = getDB as unknown as jest.Mock;

const createResponse = () => {
  const res: any = {
    statusCode: 200,
    body: undefined,
  };

  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });

  res.json = jest.fn((payload: unknown) => {
    res.body = payload;
    return res;
  });

  return res;
};

const setupUsersCollection = (usersCollection: Record<string, jest.Mock>) => {
  mockedGetDB.mockReturnValue({
    collection: jest.fn((name: string) => {
      if (name === 'users') {
        return usersCollection;
      }
      if (name === 'companies') {
        return {
          findOne: jest.fn().mockResolvedValue(null),
        };
      }
      throw new Error(`Unexpected collection requested in test: ${name}`);
    }),
  });
};

describe('Signup credit integrity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('createUser grants fixed 100 signup credits and ignores client credit fields', async () => {
    const usersCollection = {
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    };
    setupUsersCollection(usersCollection);

    const req: any = {
      body: {
        id: 'attacker-controlled-id',
        firstName: 'Alice',
        lastName: 'Example',
        email: 'ALICE@Example.COM',
        auraCredits: 999999,
        trustScore: 99,
        acquaintances: ['hijack'],
        blockedUsers: ['hijack'],
      },
    };
    const res = createResponse();

    await usersController.createUser(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(usersCollection.insertOne).toHaveBeenCalledTimes(1);
    const insertedUser = usersCollection.insertOne.mock.calls[0][0];

    expect(insertedUser.email).toBe('alice@example.com');
    expect(insertedUser.auraCredits).toBe(100);
    expect(insertedUser.auraCreditsSpent).toBe(0);
    expect(insertedUser.trustScore).toBe(10);
    expect(insertedUser.acquaintances).toEqual([]);
    expect(insertedUser.blockedUsers).toEqual([]);
    expect(insertedUser.id).not.toBe('attacker-controlled-id');
  });

  test('createUser blocks duplicate emails regardless of input casing', async () => {
    const usersCollection = {
      findOne: jest.fn().mockResolvedValue({ id: 'existing-user-id', email: 'alice@example.com' }),
      insertOne: jest.fn(),
    };
    setupUsersCollection(usersCollection);

    const req: any = {
      body: {
        firstName: 'Alice',
        lastName: 'Example',
        email: 'Alice@Example.com',
      },
    };
    const res = createResponse();

    await usersController.createUser(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(usersCollection.insertOne).not.toHaveBeenCalled();
  });
});
