import { usersController } from '../../src/controllers/usersController';
import { adsController, emitAdAnalyticsUpdate } from '../../src/controllers/adsController';
import { getDB } from '../../src/db';
import { resolveIdentityActor } from '../../src/utils/identityUtils';

jest.mock('../../src/db', () => ({
  getDB: jest.fn(),
}));

jest.mock('../../src/utils/identityUtils', () => ({
  resolveIdentityActor: jest.fn(),
}));

jest.mock('../../src/controllers/adSubscriptionsController', () => ({
  ensureCurrentPeriod: jest.fn(async (_db: any, subscription: any) => subscription),
}));

jest.mock('../../src/utils/securityLogger', () => ({
  logSecurityEvent: jest.fn(),
}));

jest.mock('../../src/controllers/postsController', () => ({
  emitAuthorInsightsUpdate: jest.fn().mockResolvedValue(undefined),
}));

const mockedGetDB = getDB as unknown as jest.Mock;
const mockedResolveIdentityActor = resolveIdentityActor as unknown as jest.Mock;

type MockCollection = Record<string, jest.Mock>;

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

describe('Analytics and credits audit guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('spendCredits rejects fractional values', async () => {
    setupDbMock({
      users: {
        findOneAndUpdate: jest.fn(),
      },
    });

    const req: any = {
      params: { id: 'user-1' },
      body: { credits: '1.5', reason: 'fractional attack' },
      app: {},
    };
    const res = createResponse();

    await usersController.spendCredits(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        error: 'Invalid credits amount',
      })
    );
  });

  test('spendCredits deducts integer credits atomically', async () => {
    const users = {
      findOneAndUpdate: jest.fn().mockResolvedValue({ value: { auraCredits: 120 } }),
    };
    setupDbMock({ users });

    const req: any = {
      params: { id: 'user-1' },
      body: { credits: 20, reason: 'boost feature' },
      app: {},
    };
    const res = createResponse();

    await usersController.spendCredits(req, res);

    expect(users.findOneAndUpdate).toHaveBeenCalledWith(
      { id: 'user-1', auraCredits: { $gte: 20 } },
      expect.objectContaining({
        $inc: { auraCredits: -20, auraCreditsSpent: 20 },
      }),
      expect.objectContaining({
        returnDocument: 'before',
      })
    );
    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          previousCredits: 120,
          newCredits: 100,
          creditsSpent: 20,
        }),
      })
    );
  });

  test('emitAdAnalyticsUpdate emits company analytics to company room', async () => {
    setupDbMock({
      adAnalytics: {
        findOne: jest.fn().mockResolvedValue({
          adId: 'ad-1',
          impressions: 25,
          clicks: 5,
          ctr: 20,
          reach: 20,
          engagement: 3,
          conversions: 1,
          spend: 9,
          lastUpdated: 123456789,
        }),
      },
    });

    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    const app = {
      get: jest.fn((key: string) => (key === 'io' ? { to } : undefined)),
    };

    await emitAdAnalyticsUpdate(app as any, 'ad-1', 'company-1', 'company');

    expect(to).toHaveBeenCalledWith('company_company-1');
    expect(emit).toHaveBeenCalledWith(
      'analytics_update',
      expect.objectContaining({
        companyId: 'company-1',
        stats: expect.objectContaining({
          adMetrics: expect.objectContaining({
            adId: 'ad-1',
            impressions: 25,
          }),
        }),
      })
    );
  });

  test('emitAdAnalyticsUpdate emits personal analytics to user room', async () => {
    setupDbMock({
      adAnalytics: {
        findOne: jest.fn().mockResolvedValue({
          adId: 'ad-2',
          impressions: 11,
          clicks: 2,
          ctr: 18.18,
          reach: 9,
          engagement: 1,
          conversions: 0,
          spend: 3,
          lastUpdated: 223456789,
        }),
      },
    });

    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    const app = {
      get: jest.fn((key: string) => (key === 'io' ? { to } : undefined)),
    };

    await emitAdAnalyticsUpdate(app as any, 'ad-2', 'user-9', 'user');

    expect(to).toHaveBeenCalledWith('user-9');
    expect(emit).toHaveBeenCalledWith(
      'analytics_update',
      expect.objectContaining({
        userId: 'user-9',
        stats: expect.objectContaining({
          adMetrics: expect.objectContaining({
            adId: 'ad-2',
            impressions: 11,
          }),
        }),
      })
    );
  });

  test('getCampaignPerformance blocks unauthorized company analytics access', async () => {
    setupDbMock({
      ads: {
        find: jest.fn(),
      },
    });
    mockedResolveIdentityActor.mockResolvedValue(null);

    const req: any = {
      params: { userId: 'company-1' },
      query: { ownerType: 'company' },
      user: { id: 'user-1', role: 'user', isAdmin: false },
    };
    const res = createResponse();

    await adsController.getCampaignPerformance(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        error: 'Forbidden',
      })
    );
  });

  test('getCampaignPerformance returns company totals when access is valid', async () => {
    const now = Date.now();
    const ads = {
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { id: 'ad-1', status: 'active' },
          { id: 'ad-2', status: 'paused' },
        ]),
      }),
    };

    const adSubscriptions = {
      findOne: jest.fn().mockResolvedValue({
        packageId: 'pkg-pro',
        endDate: now + (1000 * 60 * 60 * 24 * 7),
      }),
    };

    const adAnalytics = {
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          {
            adId: 'ad-1',
            impressions: 100,
            clicks: 10,
            reach: 90,
            engagement: 8,
            spend: 50,
            conversions: 3,
          },
          {
            adId: 'ad-2',
            impressions: 50,
            clicks: 5,
            reach: 40,
            engagement: 4,
            spend: 20,
            conversions: 1,
          },
        ]),
      }),
    };

    const adAnalyticsDaily = {
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    };

    setupDbMock({ ads, adSubscriptions, adAnalytics, adAnalyticsDaily });
    mockedResolveIdentityActor.mockResolvedValue({ id: 'company-1', type: 'company' });

    const req: any = {
      params: { userId: 'company-1' },
      query: { ownerType: 'company' },
      user: { id: 'user-1', role: 'user', isAdmin: false },
    };
    const res = createResponse();

    await adsController.getCampaignPerformance(req, res);

    expect(ads.find).toHaveBeenCalledWith({ ownerId: 'company-1', ownerType: 'company' });
    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          totalImpressions: 150,
          totalClicks: 15,
          totalReach: 130,
          totalEngagement: 12,
          totalSpend: 70,
          totalConversions: 4,
          averageCTR: 10,
          activeAds: 1,
        }),
      })
    );
  });
});
