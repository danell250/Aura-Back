
const { MongoClient } = require('mongodb');

async function listAllUsers() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/aura';
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const database = client.db('aura');
    const users = database.collection('users');

    const allUsers = await users.find({}).toArray();
    console.log(`Total users in local DB: ${allUsers.length}`);
    
    allUsers.forEach(u => {
        if (u.name && u.name.includes('Danell') || u.handle && u.handle.includes('danell')) {
            console.log(`FOUND: ${u.name} (${u.handle}) - ID: ${u.id}`);
        }
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

listAllUsers();
