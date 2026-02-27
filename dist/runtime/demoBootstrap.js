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
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadDemoPostsIfEmpty = loadDemoPostsIfEmpty;
exports.loadDemoAdsIfEmpty = loadDemoAdsIfEmpty;
const db_1 = require("../db");
function loadDemoPostsIfEmpty() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            if (!(0, db_1.isDBConnected)())
                return;
            const db = (0, db_1.getDB)();
            const count = yield db.collection('posts').countDocuments({});
            if (count > 0)
                return;
            const now = Date.now();
            const authors = [
                {
                    id: 'demo-editorial',
                    firstName: 'Aura',
                    lastName: 'Editorial',
                    name: 'Aura© Editorial Desk',
                    handle: '@auranews',
                    avatar: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?q=80&w=256&auto=format&fit=crop',
                    avatarType: 'image',
                    bio: 'Curated news and insights for modern creators and operators.',
                    trustScore: 90,
                    auraCredits: 0,
                    activeGlow: 'emerald'
                },
                {
                    id: 'demo-founder',
                    firstName: 'Nova',
                    lastName: 'Reyes',
                    name: 'Nova Reyes',
                    handle: '@novabuilds',
                    avatar: 'https://images.unsplash.com/photo-1544723795-3fb6469f5b39?q=80&w=256&auto=format&fit=crop',
                    avatarType: 'image',
                    bio: 'Bootstrapped founder sharing playbooks from the trenches.',
                    trustScore: 82,
                    auraCredits: 0,
                    activeGlow: 'none'
                },
                {
                    id: 'demo-leadership',
                    firstName: 'Elena',
                    lastName: 'Kho',
                    name: 'Elena Kho',
                    handle: '@elenaleads',
                    avatar: 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?q=80&w=256&auto=format&fit=crop',
                    avatarType: 'image',
                    bio: 'Leadership coach for high-signal teams and creators.',
                    trustScore: 88,
                    auraCredits: 0,
                    activeGlow: 'amber'
                },
                {
                    id: 'demo-agency',
                    firstName: 'Signal',
                    lastName: 'Studio',
                    name: 'Signal Studio',
                    handle: '@signalstudio',
                    avatar: 'https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?q=80&w=256&auto=format&fit=crop',
                    avatarType: 'image',
                    bio: 'Creative performance agency for ambitious brands.',
                    trustScore: 76,
                    auraCredits: 0,
                    activeGlow: 'none'
                }
            ];
            const [editorial, founder, leadership, agency] = authors;
            const posts = [
                {
                    id: 'demo-news-1',
                    author: editorial,
                    content: 'News: Independent creators just overtook legacy agencies on total campaign volume for the first time this quarter. Brands are reallocating up to 32% of paid media into creator-led storytelling.\n\nKey shifts:\n• Briefs are shorter, but context is deeper\n• Performance is measured in conversations, not just clicks\n• Creative approval cycles dropped from 21 days to 4\n\n#News #CreatorEconomy #Marketing',
                    mediaUrl: 'https://images.unsplash.com/photo-1522199755839-a2bacb67c546?q=80&w=1200&auto=format&fit=crop',
                    mediaType: 'image',
                    energy: '💡 Deep Dive',
                    radiance: 180,
                    viewCount: 1243,
                    timestamp: now - 2 * 24 * 60 * 60 * 1000,
                    reactions: { '💡': 38, '📈': 21 },
                    reactionUsers: {},
                    userReactions: [],
                    comments: [],
                    isBoosted: false,
                    hashtags: ['#News', '#CreatorEconomy', '#Marketing'],
                    taggedUserIds: []
                },
                {
                    id: 'demo-news-2',
                    author: editorial,
                    content: 'Market Update: Short-form business explainers are now the fastest growing category on Aura©, outpacing lifestyle and entertainment in week-over-week growth.\n\nIf you can teach clearly for 60 seconds, you can open an entirely new acquisition channel.\n\n#News #Business #Education',
                    mediaUrl: 'https://images.unsplash.com/photo-1525182008055-f88b95ff7980?q=80&w=1200&auto=format&fit=crop',
                    mediaType: 'image',
                    energy: '⚡ High Energy',
                    radiance: 132,
                    viewCount: 986,
                    timestamp: now - 7 * 24 * 60 * 60 * 1000,
                    reactions: { '⚡': 44, '💬': 17 },
                    reactionUsers: {},
                    userReactions: [],
                    comments: [],
                    isBoosted: false,
                    hashtags: ['#News', '#Business', '#ShortForm'],
                    taggedUserIds: []
                },
                {
                    id: 'demo-founder-1',
                    author: founder,
                    content: 'Entrepreneurship: I turned a freelance editing habit into a productized “creator ops” studio doing $45k/m with a 3-person remote team.\n\nSimple playbook:\n1) Pick one painful workflow creators avoid\n2) Productize it into a clear package with a fixed scope\n3) Layer in async check-ins instead of endless calls\n4) Let your own content be the top-of-funnel\n\nIt is easier to scale a boring, repeatable service than a clever idea.\n\n#Entrepreneurship #CreatorOps #Playbook',
                    energy: '💡 Deep Dive',
                    radiance: 210,
                    viewCount: 2113,
                    timestamp: now - 5 * 24 * 60 * 60 * 1000,
                    reactions: { '💡': 61, '🔥': 24 },
                    reactionUsers: {},
                    userReactions: [],
                    comments: [],
                    isBoosted: true,
                    hashtags: ['#Entrepreneurship', '#CreatorOps', '#Playbook'],
                    taggedUserIds: []
                },
                {
                    id: 'demo-founder-2',
                    author: founder,
                    content: 'Thread: 7 systems that took my content business from “posting randomly” to “running a proper company”.\n\n1) Monday: “pipeline” review instead of inbox review\n2) A single Notion board shared with all collaborators\n3) One analytics dashboard per offer, not per platform\n4) Weekly “kill meeting” to end weak experiments\n5) 90-minute deep work block reserved for writing\n6) Quarterly price review for every product\n7) Written operating principles so new hires onboard themselves\n\n#Entrepreneur #Systems #Execution',
                    energy: '🪐 Neutral',
                    radiance: 164,
                    viewCount: 1542,
                    timestamp: now - 10 * 24 * 60 * 60 * 1000,
                    reactions: { '📌': 33, '🧠': 29 },
                    reactionUsers: {},
                    userReactions: [],
                    comments: [],
                    isBoosted: false,
                    hashtags: ['#Entrepreneur', '#Systems', '#Execution'],
                    taggedUserIds: []
                },
                {
                    id: 'demo-leadership-1',
                    author: leadership,
                    content: 'Leadership note: Your team does not need more dashboards, they need more clarity.\n\nAsk this in your next standup:\n\n“What are we definitely not doing this week?”\n\nRemoving noise is the highest form of leadership inside a high-signal organization.\n\n#Leadership #Focus #Teams',
                    energy: '🌿 Calm',
                    radiance: 142,
                    viewCount: 879,
                    timestamp: now - 15 * 24 * 60 * 60 * 1000,
                    reactions: { '🌿': 47, '💡': 19 },
                    reactionUsers: {},
                    userReactions: [],
                    comments: [],
                    isBoosted: false,
                    hashtags: ['#Leadership', '#Focus', '#Teams'],
                    taggedUserIds: []
                },
                {
                    id: 'demo-leadership-2',
                    author: leadership,
                    content: 'The strongest leaders in 2026 will behave like great editors, not great managers.\n\nThey will:\n• Cut confusing projects\n• Trim bloated meetings\n• Rewrite vague goals into sharp sentences\n• Protect deep work like a scarce resource\n\nEdit the environment and your people will surprise you.\n\n#Leadership #Culture #Editing',
                    energy: '💡 Deep Dive',
                    radiance: 188,
                    viewCount: 1324,
                    timestamp: now - 30 * 24 * 60 * 60 * 1000,
                    reactions: { '✂️': 21, '✨': 34 },
                    reactionUsers: {},
                    userReactions: [],
                    comments: [],
                    isBoosted: false,
                    hashtags: ['#Leadership', '#Culture', '#Editing'],
                    taggedUserIds: []
                },
                {
                    id: 'demo-ad-business-1',
                    author: agency,
                    content: 'Ad: Launching a B2B podcast but worried it will become an expensive hobby?\n\nSignal Studio builds end-to-end “revenue podcasts” for SaaS and professional services.\n\nWhat we handle:\n• Strategy and show positioning\n• Guest pipeline and outreach\n• Recording, editing and clipping\n• Distribution across Aura©, LinkedIn and email\n• Revenue attribution dashboard\n\nReply “PODCAST” below and we will DM you a full case study.\n\n#B2B #Podcasting #LeadGen',
                    mediaUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?q=80&w=1200&auto=format&fit=crop',
                    mediaType: 'image',
                    energy: '⚡ High Energy',
                    radiance: 96,
                    viewCount: 1967,
                    timestamp: now - 20 * 24 * 60 * 60 * 1000,
                    reactions: { '🎙️': 18, '📈': 12 },
                    reactionUsers: {},
                    userReactions: [],
                    comments: [],
                    isBoosted: true,
                    hashtags: ['#B2B', '#Podcasting', '#LeadGen'],
                    taggedUserIds: []
                },
                {
                    id: 'demo-ad-business-2',
                    author: agency,
                    content: 'Ad: Running paid social for your business but stuck on creative?\n\nOur “Done-For-You Creative Sprint” gives you:\n• 12 ready-to-run ad concepts\n• 36 hooks tested against your audience\n• 1 brand-safe script library your team can reuse\n\nMost clients see their first winning creative within 21 days.\n\nDM “SPRINT” for the full breakdown.\n\n#Ads #BusinessGrowth #Creative',
                    energy: '🪐 Neutral',
                    radiance: 104,
                    viewCount: 743,
                    timestamp: now - 45 * 24 * 60 * 60 * 1000,
                    reactions: { '🚀': 27, '💰': 15 },
                    reactionUsers: {},
                    userReactions: [],
                    comments: [],
                    isBoosted: false,
                    hashtags: ['#Ads', '#BusinessGrowth', '#Creative'],
                    taggedUserIds: []
                }
            ];
            yield db.collection('posts').insertMany(posts);
            console.log(`✅ Loaded ${posts.length} dummy posts into MongoDB`);
        }
        catch (error) {
            console.error('⚠️ Failed to bootstrap dummy posts:', error);
        }
    });
}
function loadDemoAdsIfEmpty() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            if (!(0, db_1.isDBConnected)())
                return;
            const db = (0, db_1.getDB)();
            const count = yield db.collection('ads').countDocuments({});
            if (count > 0)
                return;
            const now = Date.now();
            const ads = [
                {
                    id: 'demo-ad-b2b-podcast',
                    ownerId: 'business-demo-1',
                    ownerName: 'Signal Studio',
                    ownerAvatar: 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?q=80&w=256&auto=format&fit=crop',
                    ownerAvatarType: 'image',
                    ownerEmail: 'hello@signalstudio.io',
                    headline: 'Turn Your B2B Podcast Into a Sales Channel',
                    description: 'We build “revenue podcasts” for B2B teams. Strategy, booking, editing, clipping, and distribution across Aura© + LinkedIn, all handled for you.\n\nClients see their first SQLs within 60–90 days of launch.\n\nTap to see the full case study.',
                    mediaUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?q=80&w=1200&auto=format&fit=crop',
                    mediaType: 'image',
                    ctaText: 'View Case Study',
                    ctaLink: 'https://example.com/b2b-podcast',
                    isSponsored: true,
                    placement: 'feed',
                    status: 'active',
                    expiryDate: now + 60 * 24 * 60 * 60 * 1000,
                    subscriptionTier: 'Aura© Radiance',
                    subscriptionId: undefined,
                    timestamp: now - 3 * 24 * 60 * 60 * 1000,
                    reactions: { '🎙️': 21, '📈': 12 },
                    reactionUsers: {},
                    hashtags: ['#B2B', '#Podcast', '#LeadGen']
                },
                {
                    id: 'demo-ad-saas-demos',
                    ownerId: 'business-demo-2',
                    ownerName: 'Pipeline Cloud',
                    ownerAvatar: 'https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?q=80&w=256&auto=format&fit=crop',
                    ownerAvatarType: 'image',
                    ownerEmail: 'growth@pipelinecloud.io',
                    headline: 'Book 40% More Qualified Demos From the Same Traffic',
                    description: 'Pipeline Cloud turns your existing traffic into qualified demos using interactive product stories.\n\nNo redesign, no new funnel – we plug into what you already have.\n\nSee how a SaaS team lifted demo volume by 42% in 45 days.',
                    mediaUrl: 'https://images.unsplash.com/photo-1553877522-43269d4ea984?q=80&w=1200&auto=format&fit=crop',
                    mediaType: 'image',
                    ctaText: 'See SaaS Playbook',
                    ctaLink: 'https://example.com/saas-playbook',
                    isSponsored: true,
                    placement: 'feed',
                    status: 'active',
                    expiryDate: now + 45 * 24 * 60 * 60 * 1000,
                    subscriptionTier: 'Universal Signal',
                    subscriptionId: undefined,
                    timestamp: now - 9 * 24 * 60 * 60 * 1000,
                    reactions: { '🚀': 34, '💰': 15 },
                    reactionUsers: {},
                    hashtags: ['#SaaS', '#DemandGen', '#Revenue']
                },
                {
                    id: 'demo-ad-founder-coaching',
                    ownerId: 'business-demo-3',
                    ownerName: 'Nova Reyes',
                    ownerAvatar: 'https://images.unsplash.com/photo-1544723795-3fb6469f5b39?q=80&w=256&auto=format&fit=crop',
                    ownerAvatarType: 'image',
                    ownerEmail: 'nova@novabuilds.io',
                    headline: 'Founder Operating System for Solo and Small Teams',
                    description: 'A 6-week live program that helps founders install a simple operating system: weekly pipeline reviews, clear scorecards, and one-page strategy docs.\n\nBuilt for content-first founders and agencies who feel “busy but blurry”.',
                    mediaUrl: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?q=80&w=1200&auto=format&fit=crop',
                    mediaType: 'image',
                    ctaText: 'Join the Next Cohort',
                    ctaLink: 'https://example.com/founder-os',
                    isSponsored: true,
                    placement: 'feed',
                    status: 'active',
                    expiryDate: now + 30 * 24 * 60 * 60 * 1000,
                    subscriptionTier: 'Creator Pro',
                    subscriptionId: undefined,
                    timestamp: now - 14 * 24 * 60 * 60 * 1000,
                    reactions: { '💡': 18, '🌿': 9 },
                    reactionUsers: {},
                    hashtags: ['#Founder', '#Systems', '#Coaching']
                }
            ];
            yield db.collection('ads').insertMany(ads);
            console.log(`✅ Loaded ${ads.length} dummy ads into MongoDB`);
        }
        catch (error) {
            console.error('⚠️ Failed to bootstrap dummy ads:', error);
        }
    });
}
