import { getDB } from '../db';
import crypto from 'crypto';

/**
 * Generates a unique handle for a company.
 */
async function generateCompanyHandle(name: string): Promise<string> {
  const db = getDB();
  const baseHandle = `@${name.toLowerCase().trim().replace(/[^a-z0-9]/g, '')}`;
  
  // Try base handle first
  const existingUser = await db.collection('users').findOne({ handle: baseHandle });
  const existingCompany = await db.collection('companies').findOne({ handle: baseHandle });
  
  if (!existingUser && !existingCompany) return baseHandle;

  // Append random numbers until unique
  for (let i = 0; i < 10; i++) {
    const candidate = `${baseHandle}${Math.floor(Math.random() * 1000)}`;
    const user = await db.collection('users').findOne({ handle: candidate });
    const comp = await db.collection('companies').findOne({ handle: candidate });
    if (!user && !comp) return candidate;
  }

  return `@comp${Date.now()}`;
}

/**
 * Migrates legacy companies (users with companyName) to the companies collection.
 */
export async function migrateLegacyCompanies(): Promise<void> {
  const db = getDB();
  console.log('🔄 Starting legacy company migration...');
  
  try {
    // Find users who have company info but are not in the companies collection
    const legacyUsers = await db.collection('users').find({
      companyName: { $exists: true, $ne: '' }
    }).toArray();
    
    let migratedCount = 0;
    let updatedCount = 0;

    for (const user of legacyUsers) {
      // Check if this user already has a company entry with their ID
      const existingCompany = await db.collection('companies').findOne({ id: user.id });
      
      if (!existingCompany) {
        // Create new company entry
        const handle = user.handle && user.handle.startsWith('@') 
          ? user.handle 
          : await generateCompanyHandle(user.companyName || user.name);

        const newCompany = {
          id: user.id,
          name: user.companyName || user.name,
          handle: handle,
          website: user.companyWebsite || '',
          industry: user.industry || 'Other',
          bio: user.bio || '',
          isVerified: user.isVerified || false,
          ownerId: user.id,
          avatar: user.avatar || '',
          avatarType: user.avatarType || 'image',
          coverImage: user.coverImage || '',
          coverType: user.coverType || 'image',
          createdAt: user.createdAt || new Date(),
          updatedAt: user.updatedAt || new Date()
        };

        await db.collection('companies').insertOne(newCompany);
        
        // Remove legacy fields from user object
        await db.collection('users').updateOne(
          { id: user.id },
          { 
            $unset: { 
              companyName: "", 
              companyWebsite: "", 
              industry: "" 
            } 
          }
        );
        
        // Ensure user also has a handle if they didn't have one (though they should)
        if (!user.handle) {
          await db.collection('users').updateOne(
            { id: user.id },
            { $set: { handle: handle } }
          );
        }

        migratedCount++;
        console.log(`✅ Migrated legacy company: ${newCompany.name} (${newCompany.handle})`);
      } else if (!existingCompany.handle) {
        // Update existing company if it's missing a handle
        const handle = user.handle && user.handle.startsWith('@') 
          ? user.handle 
          : await generateCompanyHandle(existingCompany.name);
          
        await db.collection('companies').updateOne(
          { id: existingCompany.id },
          { $set: { handle: handle, updatedAt: new Date() } }
        );
        updatedCount++;
        console.log(`✅ Updated handle for company: ${existingCompany.name} (${handle})`);
      }
    }
    
    console.log(`🏁 Migration complete. Migrated: ${migratedCount}, Updated: ${updatedCount}`);
  } catch (error) {
    console.error('❌ Error during legacy company migration:', error);
  }
}
