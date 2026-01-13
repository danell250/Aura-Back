const { MongoClient } = require('mongodb');

const uri = 'mongodb://localhost:27017/aura';
const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect();
    const database = client.db('aura');
    const users = database.collection('users');

    console.log("Connected to database");

    // Search by text or regex
    const query = {
      $or: [
        { name: /Danell Oosthuizen/i },
        { handle: /danelloosthuizen5799/i },
        { email: /danelloosthuizen5799/i }
      ]
    };

    const cursor = users.find(query);
    const results = await cursor.toArray();

    if (results.length === 0) {
      console.log("No user found matching 'Danell Oosthuizen' or 'danelloosthuizen5799'");
    } else {
      console.log(`Found ${results.length} user(s):`);
      results.forEach(user => {
        console.log(`- ID: ${user.id || user._id}`);
        console.log(`  Name: ${user.name}`);
        console.log(`  Handle: ${user.handle}`);
        console.log(`  Email: ${user.email}`);
        console.log('---');
      });
    }

  } finally {
    await client.close();
  }
}

run().catch(console.dir);
