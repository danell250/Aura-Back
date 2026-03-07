import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { getDB } from '../db';
import { transformUser } from '../utils/userUtils';
import { buildPublicAuthCallbackUrl } from '../utils/publicWebUrl';

export const configurePassportStrategies = () => {
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL:
            process.env.GOOGLE_CALLBACK_URL ||
            buildPublicAuthCallbackUrl('google'),
        },
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const displayName = profile.displayName || '';
            const nameParts = displayName.trim().split(/\s+/);
            const firstName = nameParts[0] || 'User';
            const lastName = nameParts.slice(1).join(' ') || '';
            const email = profile.emails?.[0]?.value;
            const isVerified = profile.emails?.[0]?.verified;

            if (!email) {
              return done(new Error('Google account does not have an email address'), undefined);
            }

            if (isVerified === false) {
              return done(new Error('Google email is not verified. Please verify your email on Google.'), undefined);
            }

            const user = {
              id: profile.id,
              googleId: profile.id,
              firstName,
              lastName,
              name: displayName || `${firstName} ${lastName}`.trim(),
              email: email.toLowerCase().trim(),
              avatar: profile.photos?.[0]?.value || `https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.id}`,
              avatarType: 'image' as const,
              handle: `@${firstName.toLowerCase()}${lastName.toLowerCase().replace(/\s+/g, '')}${Math.floor(Math.random() * 10000)}`,
              bio: 'New to Aura©',
              industry: 'Other',
              companyName: '',
              phone: '',
              dob: '',
              acquaintances: [],
              blockedUsers: [],
              trustScore: 10,
              auraCredits: 100,
              activeGlow: 'none' as const,
            };

            return done(null, user);
          } catch (error) {
            console.error('Error in Google OAuth strategy:', error);
            return done(error as any, undefined);
          }
        }
      )
    );
  } else {
    console.warn('⚠️ Google OAuth environment variables not found. Google login will not be available.');
  }

  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const db = getDB();
      const user = await db.collection('users').findOne({ id });

      if (user) {
        done(null, transformUser(user));
      } else {
        done(null, false);
      }
    } catch (error) {
      console.error('Error deserializing user:', error);
      done(error, null);
    }
  });

  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    passport.use(
      new GitHubStrategy(
        {
          clientID: process.env.GITHUB_CLIENT_ID,
          clientSecret: process.env.GITHUB_CLIENT_SECRET,
          callbackURL:
            process.env.GITHUB_CALLBACK_URL || buildPublicAuthCallbackUrl('github'),
          scope: ['user:email'],
        },
        async (_accessToken: any, _refreshToken: any, profile: any, done: (err: any, user?: any) => void) => {
          try {
            const displayName = profile.displayName || '';
            const username = profile.username || 'githubuser';
            const nameParts = displayName.trim().split(/\s+/);
            const firstName = nameParts[0] || username;
            const lastName = nameParts.slice(1).join(' ') || '';

            const emailObj = profile.emails?.[0];
            const email = (emailObj && emailObj.value) || `${username}@github`;

            if (emailObj && emailObj.verified === false) {
              return done(
                new Error('GitHub email is not verified. Please verify your email on GitHub.'),
                undefined
              );
            }

            const user = {
              id: profile.id,
              githubId: profile.id,
              firstName,
              lastName,
              name: displayName || username,
              email: email.toLowerCase().trim(),
              avatar:
                (profile.photos && profile.photos[0] && profile.photos[0].value) ||
                `https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.id}`,
              avatarType: 'image' as const,
              handle: `@${username.toLowerCase()}${Math.floor(Math.random() * 10000)}`,
              bio: 'New to Aura©',
              industry: 'Other',
              companyName: '',
              phone: '',
              dob: '',
              acquaintances: [],
              blockedUsers: [],
              trustScore: 10,
              auraCredits: 100,
              activeGlow: 'none' as const,
            };

            return done(null, user);
          } catch (error) {
            console.error('Error in GitHub OAuth strategy:', error);
            return done(error as any, undefined);
          }
        }
      )
    );
  } else {
    console.warn('⚠️ GitHub OAuth environment variables not found. GitHub login will not be available.');
  }
};
