import { Request, Response } from 'express';
import { getDB } from '../db';
import { User } from '../types';
import { generateQuirkyBirthdayWish } from './geminiController';

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

        announcements.push({
          id: `bday-${person.id}-${today.getFullYear()}`,
          user: {
            id: person.id,
            firstName: person.firstName,
            lastName: person.lastName,
            name: person.name,
            handle: person.handle,
            avatar: person.avatar,
            avatarType: person.avatarType
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
