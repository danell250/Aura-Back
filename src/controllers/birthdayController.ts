import { Request, Response } from 'express';
import { getDB } from '../db';
import { User } from '../types';
import { createNotificationInDB } from './notificationsController';
import { generateQuirkyBirthdayWish } from './geminiController';
import { transformUser } from '../utils/userUtils';

export const birthdayController = {
  async getTodayBirthdays(req: Request, res: Response) {
    try {
      const requester = req.user as User | undefined;
      if (!requester || !requester.id) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'User must be authenticated to get birthday announcements'
        });
      }

      const db = getDB();
      const dbUser = await db.collection('users').findOne({ id: requester.id }) as User | null;

      if (!dbUser) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          message: 'Requesting user does not exist'
        });
      }

      const acquaintances = dbUser.acquaintances || [];
      const idsToCheck = [...new Set([...acquaintances, dbUser.id])];

      if (idsToCheck.length === 0) {
        return res.json({
          success: true,
          data: [],
          message: 'No acquaintances to check for birthdays'
        });
      }

      const today = new Date();
      const mmToday = today.getMonth() + 1;
      const ddToday = today.getDate();
      const currentYear = today.getFullYear();

      const users = await db.collection('users').find({
        id: { $in: idsToCheck },
        dob: { $exists: true, $ne: '' }
      }).toArray() as unknown as User[];

      const birthdayUsers = users.filter(u => {
        if (!u.dob) return false;
        const d = new Date(u.dob);
        if (Number.isNaN(d.getTime())) return false;
        return (d.getMonth() + 1) === mmToday && d.getDate() === ddToday;
      });

      if (birthdayUsers.length === 0) {
        return res.json({
          success: true,
          data: [],
          message: 'No birthdays today'
        });
      }

      const announcements = [];
      for (const person of birthdayUsers) {
        const mockReq = { body: { name: person.firstName, bio: person.bio || '' } } as Request;
        let wishText = '';

        await new Promise<void>((resolve) => {
          const mockRes = {
            json: (payload: any) => {
              wishText = payload.text || '';
              resolve();
            },
            status: () => ({
              json: (payload: any) => {
                wishText = payload.error || '';
                resolve();
              }
            })
          } as unknown as Response;

          generateQuirkyBirthdayWish(mockReq, mockRes);
        });

        const postId = `bday-post-${person.id}-${currentYear}`;

        const existingPost = await db.collection('posts').findOne({
          isSystemPost: true,
          systemType: 'birthday',
          ownerId: person.id,
          birthdayYear: currentYear
        });

        if (!existingPost) {
          const supportEmail = 'aurasocialradiate@gmail.com';
          const supportUser = await db.collection('users').findOne({ email: supportEmail });
          const authorId = supportUser?.id || `support-${supportEmail}`;

          await db.collection('posts').insertOne({
            id: postId,
            author: supportUser ? {
              id: supportUser.id,
              firstName: supportUser.firstName,
              lastName: supportUser.lastName,
              name: supportUser.name,
              handle: supportUser.handle,
              avatar: supportUser.avatar,
              avatarType: supportUser.avatarType || 'image',
              activeGlow: supportUser.activeGlow
            } : {
              id: authorId,
              firstName: 'Aura',
              lastName: 'Support',
              name: 'Aura Support',
              handle: '@aurasupport',
              avatar: '/og-image.jpg',
              avatarType: 'image',
              activeGlow: 'emerald'
            },
            authorId,
            ownerId: person.id,
            content: wishText || `🎉 Happy Birthday ${person.firstName}! Your aura is radiant today.`,
            mediaUrl: undefined,
            mediaType: undefined,
            mediaItems: undefined,
            sharedFrom: undefined,
            energy: '🎉 Celebrating',
            radiance: 0,
            timestamp: Date.now(),
            reactions: {},
            reactionUsers: {},
            userReactions: [],
            comments: [],
            isBoosted: false,
            viewCount: 0,
            hashtags: [],
            taggedUserIds: [],
            visibility: 'private',
            isBirthdayPost: true,
            isSystemPost: true,
            systemType: 'birthday',
            birthdayYear: currentYear
          });

          const acquaintancesForOwner = person.acquaintances || [];
          if (acquaintancesForOwner.length > 0) {
            const yearKey = `birthday-${person.id}-${currentYear}`;
            await Promise.all(
              acquaintancesForOwner
                .filter(id => id && id !== person.id)
                .map(id =>
                  createNotificationInDB(
                    id,
                    'birthday',
                    person.id,
                    `It’s ${person.firstName}'s birthday today 🎂`,
                    postId,
                    undefined,
                    { birthdayUserId: person.id, year: currentYear },
                    yearKey
                  ).catch(err => {
                    console.error('Error creating birthday notification from system post:', err);
                  })
                )
            );
          }
        }

        const transformedPerson = transformUser(person);
        
        announcements.push({
          id: `bday-${person.id}-${today.getFullYear()}`,
          user: {
            id: transformedPerson.id,
            firstName: transformedPerson.firstName,
            lastName: transformedPerson.lastName,
            name: transformedPerson.name,
            handle: transformedPerson.handle,
            avatar: transformedPerson.avatar,
            avatarType: transformedPerson.avatarType
          },
          wish: wishText,
          reactions: {},
          userReactions: []
        });
      }

      res.json({
        success: true,
        data: announcements,
        message: 'Birthday announcements generated successfully'
      });
    } catch (error) {
      console.error('Error generating birthday announcements:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate birthday announcements',
        message: 'Internal server error'
      });
    }
  }
};
