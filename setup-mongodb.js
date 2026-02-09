#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 MongoDB Setup Assistant for Aura™ Social Backend\n');

// Check if MongoDB is installed locally
function checkLocalMongoDB() {
  try {
    execSync('mongod --version', { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

// Check if MongoDB service is running
function checkMongoDBService() {
  try {
    execSync('mongo --eval "db.runCommand({ connectionStatus: 1 })"', { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

// Install MongoDB locally (macOS with Homebrew)
function installMongoDBMac() {
  console.log('📦 Installing MongoDB using Homebrew...');
  try {
    execSync('brew tap mongodb/brew', { stdio: 'inherit' });
    execSync('brew install mongodb-community', { stdio: 'inherit' });
    console.log('✅ MongoDB installed successfully!');
    return true;
  } catch (error) {
    console.error('❌ Failed to install MongoDB:', error.message);
    return false;
  }
}

// Start MongoDB service
function startMongoDBService() {
  console.log('🔄 Starting MongoDB service...');
  try {
    if (process.platform === 'darwin') {
      // macOS
      execSync('brew services start mongodb/brew/mongodb-community', { stdio: 'inherit' });
    } else if (process.platform === 'linux') {
      // Linux
      execSync('sudo systemctl start mongod', { stdio: 'inherit' });
    } else {
      console.log('⚠️  Please start MongoDB manually for your operating system');
      return false;
    }
    console.log('✅ MongoDB service started!');
    return true;
  } catch (error) {
    console.error('❌ Failed to start MongoDB service:', error.message);
    return false;
  }
}

// Create .env file with MongoDB Atlas connection
function setupAtlasConnection() {
  console.log('\n🌐 Setting up MongoDB Atlas connection...');
  console.log('Please follow these steps:');
  console.log('1. Go to https://cloud.mongodb.com');
  console.log('2. Create a free account or sign in');
  console.log('3. Create a new cluster (free tier available)');
  console.log('4. Create a database user');
  console.log('5. Whitelist your IP address (or use 0.0.0.0/0 for development)');
  console.log('6. Get your connection string');
  console.log('\nExample connection string:');
  console.log('mongodb+srv://YOUR_USERNAME:YOUR_PASSWORD@cluster0.xxxxx.mongodb.net/aura?retryWrites=true&w=majority');
  
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    readline.question('\nEnter your MongoDB Atlas connection string: ', (connectionString) => {
      if (connectionString.trim()) {
        updateEnvFile('MONGO_URI', connectionString.trim());
        console.log('✅ MongoDB Atlas connection string saved to .env file');
      }
      readline.close();
      resolve();
    });
  });
}

// Update .env file
function updateEnvFile(key, value) {
  const envPath = path.join(__dirname, '.env');
  let envContent = '';
  
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }
  
  const lines = envContent.split('\n');
  let keyFound = false;
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(`${key}=`)) {
      lines[i] = `${key}=${value}`;
      keyFound = true;
      break;
    }
  }
  
  if (!keyFound) {
    lines.push(`${key}=${value}`);
  }
  
  fs.writeFileSync(envPath, lines.join('\n'));
}

// Main setup function
async function main() {
  console.log('Choose your MongoDB setup option:\n');
  console.log('1. 🏠 Local MongoDB (recommended for development)');
  console.log('2. ☁️  MongoDB Atlas (recommended for production)');
  console.log('3. ❓ Check current setup\n');
  
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  readline.question('Enter your choice (1, 2, or 3): ', async (choice) => {
    switch (choice.trim()) {
      case '1':
        console.log('\n🏠 Setting up Local MongoDB...\n');
        
        if (!checkLocalMongoDB()) {
          console.log('❌ MongoDB not found locally');
          
          if (process.platform === 'darwin') {
            readline.question('Would you like to install MongoDB using Homebrew? (y/n): ', (install) => {
              if (install.toLowerCase() === 'y') {
                if (installMongoDBMac()) {
                  startMongoDBService();
                  updateEnvFile('MONGO_URI', 'mongodb://localhost:27017/aura');
                  console.log('✅ Local MongoDB setup complete!');
                }
              } else {
                console.log('Please install MongoDB manually and run this script again.');
              }
              readline.close();
            });
          } else {
            console.log('Please install MongoDB for your operating system:');
            console.log('- Ubuntu/Debian: https://docs.mongodb.com/manual/tutorial/install-mongodb-on-ubuntu/');
            console.log('- CentOS/RHEL: https://docs.mongodb.com/manual/tutorial/install-mongodb-on-red-hat/');
            console.log('- Windows: https://docs.mongodb.com/manual/tutorial/install-mongodb-on-windows/');
            readline.close();
          }
        } else {
          console.log('✅ MongoDB is installed locally');
          
          if (!checkMongoDBService()) {
            console.log('⚠️  MongoDB service is not running');
            startMongoDBService();
          } else {
            console.log('✅ MongoDB service is running');
          }
          
          updateEnvFile('MONGO_URI', 'mongodb://localhost:27017/aura');
          console.log('✅ Local MongoDB setup complete!');
          readline.close();
        }
        break;
        
      case '2':
        await setupAtlasConnection();
        break;
        
      case '3':
        console.log('\n🔍 Checking current setup...\n');
        
        const envPath = path.join(__dirname, '.env');
        if (fs.existsSync(envPath)) {
          const envContent = fs.readFileSync(envPath, 'utf8');
          const mongoUri = envContent.match(/MONGO_URI=(.+)/);
          
          if (mongoUri) {
            console.log('📄 Current MONGO_URI:', mongoUri[1]);
            
            if (mongoUri[1].includes('mongodb+srv')) {
              console.log('☁️  Using MongoDB Atlas');
            } else if (mongoUri[1].includes('localhost')) {
              console.log('🏠 Using Local MongoDB');
              
              if (checkLocalMongoDB()) {
                console.log('✅ MongoDB is installed locally');
                
                if (checkMongoDBService()) {
                  console.log('✅ MongoDB service is running');
                } else {
                  console.log('❌ MongoDB service is not running');
                  console.log('💡 Run: brew services start mongodb/brew/mongodb-community (macOS)');
                  console.log('💡 Run: sudo systemctl start mongod (Linux)');
                }
              } else {
                console.log('❌ MongoDB is not installed locally');
              }
            }
          } else {
            console.log('❌ No MONGO_URI found in .env file');
          }
        } else {
          console.log('❌ No .env file found');
        }
        readline.close();
        break;
        
      default:
        console.log('❌ Invalid choice. Please run the script again.');
        readline.close();
    }
  });
}

// Run the setup
main().catch(console.error);