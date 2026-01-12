
const fetch = require('node-fetch'); // Ensure node-fetch is installed or use built-in fetch in Node 18+

async function deleteRemoteUser() {
  // Default to the ID found in production search
  const defaultId = '7GPjkqWw38gyoM0Y3M5lDb8XWJn1'; 
  
  // Allow passing ID as command line argument
  const userId = process.argv[2] || defaultId;
  
  const baseUrl = 'https://aura-back-s1bw.onrender.com';
  const adminSecret = 'aura-force-delete-2024'; 

  console.log(`\n🗑️  Attempting to delete user with ID: ${userId}`);
  console.log(`📍 Target: ${baseUrl}`);

  try {
    const response = await fetch(`${baseUrl}/api/users/admin/force-delete/${userId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-secret': adminSecret
      }
    });

    const data = await response.json();
    
    console.log('----------------------------------------');
    console.log(`Status: ${response.status} ${response.statusText}`);
    console.log('Response:', JSON.stringify(data, null, 2));
    console.log('----------------------------------------');

    if (response.ok) {
      console.log('✅ SUCCESS: User successfully deleted from production!');
    } else {
      console.log('❌ FAILURE: Could not delete user.');
      
      if (response.status === 404) {
          if (data.message && data.message.includes('Route')) {
              console.log('⚠️  REASON: The "Force Delete" endpoint is NOT deployed yet.');
              console.log('👉 ACTION REQUIRED: Deploy the latest backend code to Render.');
          } else {
              console.log('⚠️  REASON: User not found (possibly already deleted).');
          }
      } else if (response.status === 403) {
          console.log('🔒 REASON: Unauthorized. Admin secret mismatch.');
      }
    }
  } catch (error) {
    console.error('❌ ERROR: Network request failed:', error.message);
  }
}

// Check if we can use built-in fetch (Node 18+) or need to warn
if (!globalThis.fetch) {
    console.log('⚠️  Warning: This script uses "fetch". If it fails, please use Node.js 18+');
}

deleteRemoteUser();
