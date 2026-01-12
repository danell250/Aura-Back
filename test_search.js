
const { MongoClient } = require('mongodb');

async function searchUsers(searchTerm) {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/aura';
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const database = client.db('aura');
    const users = database.collection('users');

    const searchRegex = new RegExp(searchTerm, 'i');
    console.log(`Searching for "${searchTerm}" with regex ${searchRegex}`);

    const searchResults = await users.find({
        $and: [
          // Privacy filter: only show users who allow being found in search
          {
            $or: [
              { 'privacySettings.showInSearch': { $ne: false } },
              { 'privacySettings.showInSearch': { $exists: false } }
            ]
          },
          // Text search filter
          {
            $or: [
              { name: searchRegex },
              { firstName: searchRegex },
              { lastName: searchRegex },
              { handle: searchRegex },
              { email: searchRegex },
              { bio: searchRegex }
            ]
          }
        ]
      }).toArray();

    console.log(`Found ${searchResults.length} results`);
    searchResults.forEach(u => console.log(`- ${u.name} (${u.handle})`));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

// Test searches
async function run() {
    await searchUsers('john');
    await searchUsers('smith');
    await searchUsers('doe');
    await searchUsers('jane');
    await searchUsers('nomatch');
}

run();
