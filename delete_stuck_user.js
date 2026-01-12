
const { MongoClient } = require('mongodb');

async function deleteStuckUser() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/aura';
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const database = client.db('aura');
    const users = database.collection('users');

    const targetId = '7GPjkqWw38gyoM0Y3M5lDb8XWJn1';
    
    // 1. Verify user exists
    console.log(`Searching for user with ID: ${targetId}`);
    const user = await users.findOne({ id: targetId });

    if (!user) {
      console.log('❌ User not found with that ID.');
      
      // Try searching by handle just in case ID was wrong
      console.log('Trying search by handle @danelloosthuizen5799...');
      const userByHandle = await users.findOne({ handle: '@danelloosthuizen5799' });
      
      if (userByHandle) {
        console.log('✅ Found user by handle!');
        console.log(`ID: ${userByHandle.id}`);
        console.log(`Name: ${userByHandle.name}`);
        console.log(`Handle: ${userByHandle.handle}`);
        
        console.log('Deleting user...');
        const result = await users.deleteOne({ id: userByHandle.id });
        console.log(`Deleted count: ${result.deletedCount}`);
      } else {
        console.log('❌ User not found by handle either.');
      }
      
      return;
    }

    console.log('✅ User found:');
    console.log(`ID: ${user.id}`);
    console.log(`Name: ${user.name}`);
    console.log(`Handle: ${user.handle}`);

    // Verify it matches the description
    if (user.handle === '@danelloosthuizen5799' || user.name === 'Danell Oosthuizen') {
        console.log('MATCH CONFIRMED. Deleting user...');
        const result = await users.deleteOne({ id: targetId });
        
        if (result.deletedCount === 1) {
            console.log('✅ User successfully deleted from database.');
        } else {
            console.log('⚠️ Delete operation returned 0 deleted documents.');
        }
    } else {
        console.log('⚠️ User found but details do not match expected handle/name. Aborting delete for safety.');
        console.log(`Expected: Danell Oosthuizen / @danelloosthuizen5799`);
        console.log(`Found: ${user.name} / ${user.handle}`);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

deleteStuckUser();
