import { connectDB, getDB, closeDB } from '../db';

(async () => {
  try {
    await connectDB();
    const db = getDB();

    await db.collection('users').updateMany(
      { userMode: { $in: ['business', 'corporate'] } },
      { $set: { userMode: 'company' } }
    );

    const companies = await db.collection('companies').find({}).toArray();
    for (const c of companies) {
      const subscribers = Array.isArray((c as any).subscribers)
        ? [...new Set((c as any).subscribers)]
        : Array.isArray((c as any).acquaintances)
          ? [...new Set((c as any).acquaintances)]
          : [];

      await db.collection('companies').updateOne(
        { id: c.id },
        { $set: { subscribers, subscriberCount: subscribers.length }, $unset: { acquaintances: '' } as any }
      );

      if (subscribers.length) {
        await db.collection('users').updateMany(
          { id: { $in: subscribers } },
          { $addToSet: { subscribedCompanyIds: c.id } as any }
        );
      }
    }

    console.log('Migration completed');
  } finally {
    await closeDB();
  }
})();
