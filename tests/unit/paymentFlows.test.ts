import axios from 'axios';
import { usersController } from '../../src/controllers/usersController';
import { adSubscriptionsController } from '../../src/controllers/adSubscriptionsController';
import { getDB } from '../../src/db';
import { resolveIdentityActor } from '../../src/utils/identityUtils';

jest.mock('axios');
jest.mock('../../src/db', () => ({
  getDB: jest.fn(),
}));
jest.mock('../../src/utils/identityUtils', () => ({
  resolveIdentityActor: jest.fn(),
}));
jest.mock('../../src/utils/securityLogger', () => ({
  logSecurityEvent: jest.fn(),
}));
jest.mock('../../src/controllers/postsController', () => ({
  emitAuthorInsightsUpdate: jest.fn().mockResolvedValue(undefined),
}));

type MockCollection = Record<string, jest.Mock>;

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedGetDB = getDB as unknown as jest.Mock;
const mockedResolveIdentityActor = resolveIdentityActor as unknown as jest.Mock;

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

const setupDbMock = (collections: Record<string, MockCollection>) => {
  const db = {
    collection: jest.fn((name: string) => {
      const collection = collections[name];
      if (!collection) {
        throw new Error(`Missing mock collection: ${name}`);
      }
      return collection;
    }),
  };
  mockedGetDB.mockReturnValue(db);
  return db;
};

const originalEnv = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    PAYPAL_CLIENT_ID: 'test-paypal-client',
    PAYPAL_CLIENT_SECRET: 'test-paypal-secret',
    PAYPAL_API_BASE: 'https://api-m.sandbox.paypal.com',
  };
});

afterAll(() => {
  process.env = originalEnv;
});

describe('Payment flow regression tests (mocked)', () => {
  test('purchaseCredits rejects mismatched PayPal amount', async () => {
    const transactions = {
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn(),
      updateOne: jest.fn(),
    };
    const users = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    setupDbMock({ transactions, users });

    mockedAxios.post.mockResolvedValueOnce({ data: { access_token: 'token-1' } } as any);
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        status: 'COMPLETED',
        purchase_units: [
          {
            amount: { currency_code: 'USD', value: '10.00' }, // mismatch vs Neural Spark (39.99)
            payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED' }] },
          },
        ],
      },
    } as any);

    const req: any = {
      params: { id: 'user-1' },
      body: { bundleName: 'Neural Spark', orderId: 'ORDER-MISMATCH', paymentMethod: 'paypal' },
      app: {},
    };
    const res = createResponse();

    await usersController.purchaseCredits(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        error: 'Invalid payment amount',
      })
    );
    expect(users.findOne).not.toHaveBeenCalled();
    expect(transactions.insertOne).not.toHaveBeenCalled();
  });

  test('purchaseCredits completes and marks transaction applied', async () => {
    const transactions = {
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockResolvedValue({ insertedId: 'tx-pending-1' }),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const users = {
      findOne: jest.fn().mockResolvedValue({ id: 'user-1', auraCredits: 25 }),
      findOneAndUpdate: jest.fn().mockResolvedValue({ value: { auraCredits: 525 } }),
    };
    setupDbMock({ transactions, users });

    mockedAxios.post.mockResolvedValueOnce({ data: { access_token: 'token-2' } } as any);
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        status: 'COMPLETED',
        purchase_units: [
          {
            amount: { currency_code: 'USD', value: '39.99' },
            payments: { captures: [{ id: 'CAP-2', status: 'COMPLETED' }] },
          },
        ],
      },
    } as any);

    const req: any = {
      params: { id: 'user-1' },
      body: { bundleName: 'Neural Spark', orderId: 'ORDER-OK', paymentMethod: 'paypal' },
      app: {},
    };
    const res = createResponse();

    await usersController.purchaseCredits(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          userId: 'user-1',
          creditsAdded: 500,
          previousCredits: 25,
          newCredits: 525,
        }),
      })
    );
    expect(transactions.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        type: 'credit_purchase',
        status: 'processing',
        creditsApplied: false,
        paymentReferenceKey: 'paypal_order:ORDER-OK',
      })
    );
    expect(transactions.updateOne).toHaveBeenCalledWith(
      { _id: 'tx-pending-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'completed',
          creditsApplied: true,
        }),
      })
    );
  });

  test('adSubscriptions rejects recurring statuses that are not ACTIVE', async () => {
    mockedResolveIdentityActor.mockResolvedValue({ id: 'user-1', type: 'user' });

    const transactions = {
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn(),
    };
    const adSubscriptions = {
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn(),
      deleteOne: jest.fn(),
    };
    setupDbMock({ transactions, adSubscriptions });

    mockedAxios.post.mockResolvedValueOnce({ data: { access_token: 'token-3' } } as any);
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        status: 'APPROVAL_PENDING',
        plan_id: 'P-7BE61882EP388262CNFRU2NA',
      },
    } as any);

    const req: any = {
      user: { id: 'user-1' },
      body: {
        packageId: 'pkg-pro',
        ownerType: 'user',
        paypalSubscriptionId: 'SUB-PENDING',
      },
      app: {},
    };
    const res = createResponse();

    await adSubscriptionsController.createSubscription(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        error: 'Subscription not active',
      })
    );
    expect(adSubscriptions.insertOne).not.toHaveBeenCalled();
  });

  test('adSubscriptions rolls back subscription when transaction write fails', async () => {
    mockedResolveIdentityActor.mockResolvedValue({ id: 'user-1', type: 'user' });

    const transactions = {
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockRejectedValue({ code: 11000 }),
    };
    const adSubscriptions = {
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    };
    setupDbMock({ transactions, adSubscriptions });

    mockedAxios.post.mockResolvedValueOnce({ data: { access_token: 'token-4' } } as any);
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        status: 'COMPLETED',
        purchase_units: [
          {
            amount: { currency_code: 'USD', value: '39.00' },
            payments: { captures: [{ id: 'CAP-4', status: 'COMPLETED' }] },
          },
        ],
      },
    } as any);

    const req: any = {
      user: { id: 'user-1' },
      body: {
        packageId: 'pkg-starter',
        ownerType: 'user',
        paypalOrderId: 'ORDER-ROLLBACK',
      },
      app: {},
    };
    const res = createResponse();

    await adSubscriptionsController.createSubscription(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        error: 'Duplicate transaction',
      })
    );
    expect(adSubscriptions.deleteOne).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentReferenceKey: 'paypal_order:ORDER-ROLLBACK',
      })
    );
  });
});
