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
      const [migratedCompany, legacySameIdCompany] = await Promise.all([
        db.collection('companies').findOne({ legacySourceUserId: user.id }),
        db.collection('companies').findOne({ id: user.id, ownerId: user.id }),
      ]);

      if (!migratedCompany) {
        const name = (user.companyName || legacySameIdCompany?.name || user.name || 'Company').trim();
        const website = (user.companyWebsite || legacySameIdCompany?.website || '').trim();
        const industry = (user.industry || legacySameIdCompany?.industry || 'Other').trim() || 'Other';
        const handle = await generateCompanyHandle(name);
        const companyId = `comp-${crypto.randomBytes(8).toString('hex')}`;

        const newCompany = {
          id: companyId,
          legacySourceUserId: user.id,
          name,
          handle,
          website,
          industry,
          bio: '',
          isVerified: !!website,
          ownerId: user.id,
          avatar: '',
          avatarType: 'image',
          coverImage: '',
          coverType: 'image',
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        await db.collection('companies').insertOne(newCompany);
        await db.collection('company_members').updateOne(
          { companyId, userId: user.id },
          {
            $set: {
              companyId,
              userId: user.id,
              role: 'owner',
              joinedAt: new Date(),
              updatedAt: new Date(),
            },
          },
          { upsert: true },
        );

        if (legacySameIdCompany) {
          await db.collection('companies').updateOne(
            { id: legacySameIdCompany.id },
            {
              $set: {
                legacyArchived: true,
                supersededByCompanyId: companyId,
                updatedAt: new Date(),
              },
            },
          );
        }

        migratedCount++;
        console.log(`✅ Migrated legacy company: ${newCompany.name} (${newCompany.handle})`);
      } else if (!migratedCompany.handle) {
        const handle = await generateCompanyHandle(migratedCompany.name || user.companyName || user.name);
        await db.collection('companies').updateOne(
          { id: migratedCompany.id },
          { $set: { handle, updatedAt: new Date() } },
        );
        updatedCount++;
        console.log(`✅ Updated handle for company: ${migratedCompany.name} (${handle})`);
      }

      await db.collection('users').updateOne(
        { id: user.id },
        {
          $unset: {
            companyName: '',
            companyWebsite: '',
            industry: '',
          },
        },
      );
    }
    
    console.log(`🏁 Migration complete. Migrated: ${migratedCount}, Updated: ${updatedCount}`);
  } catch (error) {
    console.error('❌ Error during legacy company migration:', error);
  }
}
