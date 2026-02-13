import { connectDB, getDB, closeDB } from '../db';

async function migrateUserModes() {
  const db = await connectDB();
  if (!db) {
    throw new Error('Database connection failed');
  }

  const usersCol = getDB().collection('users');
  const users = await usersCol.find({ userMode: 'business' }).toArray();

  let updated = 0;
  for (const user of users) {
    const res = await usersCol.updateOne(
      { _id: user._id },
      { $set: { userMode: 'corporate' } }
    );
    if (res.modifiedCount === 1) {
      updated++;
    }
  }

  console.log(`Migrated ${updated} users from 'business' to 'corporate'`);
}

(async () => {
  try {
    await migrateUserModes();
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await closeDB();
  }
})();

