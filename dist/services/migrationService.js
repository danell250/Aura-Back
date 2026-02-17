"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrateLegacyCompanies = migrateLegacyCompanies;
const db_1 = require("../db");
const crypto_1 = __importDefault(require("crypto"));
/**
 * Generates a unique handle for a company.
 */
function generateCompanyHandle(name) {
    return __awaiter(this, void 0, void 0, function* () {
        const db = (0, db_1.getDB)();
        const baseHandle = `@${name.toLowerCase().trim().replace(/[^a-z0-9]/g, '')}`;
        // Try base handle first
        const existingUser = yield db.collection('users').findOne({ handle: baseHandle });
        const existingCompany = yield db.collection('companies').findOne({ handle: baseHandle });
        if (!existingUser && !existingCompany)
            return baseHandle;
        // Append random numbers until unique
        for (let i = 0; i < 10; i++) {
            const candidate = `${baseHandle}${Math.floor(Math.random() * 1000)}`;
            const user = yield db.collection('users').findOne({ handle: candidate });
            const comp = yield db.collection('companies').findOne({ handle: candidate });
            if (!user && !comp)
                return candidate;
        }
        return `@comp${Date.now()}`;
    });
}
/**
 * Migrates legacy companies (users with companyName) to the companies collection.
 */
function migrateLegacyCompanies() {
    return __awaiter(this, void 0, void 0, function* () {
        const db = (0, db_1.getDB)();
        console.log('🔄 Starting legacy company migration...');
        try {
            // Find users who have company info but are not in the companies collection
            const legacyUsers = yield db.collection('users').find({
                companyName: { $exists: true, $ne: '' }
            }).toArray();
            let migratedCount = 0;
            let updatedCount = 0;
            for (const user of legacyUsers) {
                const [migratedCompany, legacySameIdCompany] = yield Promise.all([
                    db.collection('companies').findOne({ legacySourceUserId: user.id }),
                    db.collection('companies').findOne({ id: user.id, ownerId: user.id }),
                ]);
                if (!migratedCompany) {
                    const name = (user.companyName || (legacySameIdCompany === null || legacySameIdCompany === void 0 ? void 0 : legacySameIdCompany.name) || user.name || 'Company').trim();
                    const website = (user.companyWebsite || (legacySameIdCompany === null || legacySameIdCompany === void 0 ? void 0 : legacySameIdCompany.website) || '').trim();
                    const industry = (user.industry || (legacySameIdCompany === null || legacySameIdCompany === void 0 ? void 0 : legacySameIdCompany.industry) || 'Other').trim() || 'Other';
                    const handle = yield generateCompanyHandle(name);
                    const companyId = `comp-${crypto_1.default.randomBytes(8).toString('hex')}`;
                    const newCompany = {
                        id: companyId,
                        legacySourceUserId: user.id,
                        name,
                        handle,
                        website,
                        industry,
                        bio: '',
                        isPrivate: false,
                        isVerified: !!website,
                        ownerId: user.id,
                        avatar: '',
                        avatarType: 'image',
                        coverImage: '',
                        coverType: 'image',
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    };
                    yield db.collection('companies').insertOne(newCompany);
                    yield db.collection('company_members').updateOne({ companyId, userId: user.id }, {
                        $set: {
                            companyId,
                            userId: user.id,
                            role: 'owner',
                            joinedAt: new Date(),
                            updatedAt: new Date(),
                        },
                    }, { upsert: true });
                    if (legacySameIdCompany) {
                        yield db.collection('companies').updateOne({ id: legacySameIdCompany.id }, {
                            $set: {
                                legacyArchived: true,
                                supersededByCompanyId: companyId,
                                updatedAt: new Date(),
                            },
                        });
                    }
                    migratedCount++;
                    console.log(`✅ Migrated legacy company: ${newCompany.name} (${newCompany.handle})`);
                }
                else if (!migratedCompany.handle) {
                    const handle = yield generateCompanyHandle(migratedCompany.name || user.companyName || user.name);
                    yield db.collection('companies').updateOne({ id: migratedCompany.id }, { $set: { handle, updatedAt: new Date() } });
                    updatedCount++;
                    console.log(`✅ Updated handle for company: ${migratedCompany.name} (${handle})`);
                }
                yield db.collection('users').updateOne({ id: user.id }, {
                    $unset: {
                        companyName: '',
                        companyWebsite: '',
                        industry: '',
                    },
                });
            }
            console.log(`🏁 Migration complete. Migrated: ${migratedCount}, Updated: ${updatedCount}`);
        }
        catch (error) {
            console.error('❌ Error during legacy company migration:', error);
        }
    });
}
