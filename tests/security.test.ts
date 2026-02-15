/// <reference types="jest" />
import request from 'supertest';
import { app } from '../src/index';
import { getDB } from '../src/db';
import { generateAccessToken } from '../src/utils/jwtUtils';
import { clearDatabase } from './setup';
import { ObjectId } from 'mongodb';

describe('Security Integration Tests', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  const createUser = async (userData: any) => {
    const db = getDB();
    const handle = userData.handle || `@${userData.id || Math.random().toString(36).substring(7)}`;
    const result = await db.collection('users').insertOne({
      ...userData,
      id: userData.id || new ObjectId().toString(),
      handle,
      trustScore: userData.trustScore || 10,
      auraCredits: userData.auraCredits || 100,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    return userData;
  };

  const userA = { id: 'user-a', email: 'user-a@example.com', name: 'User A' };
  const userB = { id: 'user-b', email: 'user-b@example.com', name: 'User B' };
  const adminUser = { id: 'admin-user', email: 'admin@example.com', name: 'Admin User' };

  describe('Messages & Notifications Privacy', () => {
    test('User A cannot read User B messages', async () => {
      await createUser(userA);
      await createUser(userB);
      
      const tokenA = generateAccessToken(userA as any);
      
      // Create a message for User B
      const db = getDB();
      const messageId = new ObjectId().toString();
      await db.collection('messages').insertOne({
        id: messageId,
        senderId: 'someone-else',
        receiverId: userB.id,
        content: 'Secret message for B',
        timestamp: new Date()
      });

      // User A tries to read User B's messages
      const response = await request(app)
        .get(`/api/messages/${userB.id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      // The API should either return 403 or only messages where User A is sender/receiver
      // Assuming the endpoint returns conversations for the authenticated user
      // If they try to access a conversation they aren't part of, it should be empty or 403
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      const messages = response.body.data || [];
      const hasBMessage = messages.some((m: any) => m.content === 'Secret message for B');
      expect(hasBMessage).toBe(false);
    });

    test('User A cannot read User B notifications', async () => {
      await createUser(userA);
      await createUser(userB);
      
      const tokenA = generateAccessToken(userA as any);
      
      // Create a notification for User B
      const db = getDB();
      await db.collection('notifications').insertOne({
        id: new ObjectId().toString(),
        userId: userB.id,
        type: 'post_like',
        message: 'Someone liked your post',
        read: false,
        timestamp: new Date()
      });

      // User A tries to get notifications
      const response = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      const notifications = response.body.data || [];
      const hasBNotification = notifications.some((n: any) => n.userId === userB.id);
      expect(hasBNotification).toBe(false);
    });
  });

  describe('Company Data Access', () => {
    const company = {
      id: 'company-1',
      name: 'Test Corp',
      ownerId: 'admin-user',
      handle: 'testcorp'
    };

    test('Non-member cannot access company management data', async () => {
      await createUser(userA);
      await createUser(adminUser);
      const db = getDB();
      await db.collection('companies').insertOne(company);
      
      const tokenA = generateAccessToken(userA as any);

      // User A tries to access company members (management route)
      const response = await request(app)
        .get(`/api/companies/${company.id}/members`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(response.status).toBe(403);
    });

    test('Member can access allowed company scopes, but not admin-only scopes', async () => {
      await createUser(userA); // Member
      await createUser(adminUser); // Owner/Admin
      const db = getDB();
      await db.collection('companies').insertOne(company);
      await db.collection('company_members').insertOne({
        companyId: company.id,
        userId: userA.id,
        role: 'member'
      });
      
      const tokenA = generateAccessToken(userA as any);

      // Member tries to access admin-only invites list (owner/admin only)
      const response = await request(app)
        .get(`/api/companies/${company.id}/invites`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(response.status).toBe(403);
    });
  });

  describe('Forged Identity Protection', () => {
    test('Should reject post creation if forged authorId/ownerId is provided', async () => {
      await createUser(userA);
      await createUser(userB);
      
      const tokenA = generateAccessToken(userA as any);

      // User A tries to create a post as User B
      const response = await request(app)
        .post('/api/posts')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          content: 'I am User B (not really)',
          authorId: userB.id, // Forged authorId
          energy: '🪐 Neutral'
        });

      // The backend should use resolveIdentityActor and detect the mismatch
      // It should either overwrite authorId with userA.id or reject the request
      expect(response.status).toBe(201); // Created
      expect(response.body.data.author.id).toBe(userA.id); // Should have been corrected to User A
      expect(response.body.data.author.id).not.toBe(userB.id);
    });

    test('Should reject company post if user is not a member of that company', async () => {
      await createUser(userA);
      const db = getDB();
      await db.collection('companies').insertOne({
        id: 'other-company',
        name: 'Other Corp',
        ownerId: 'user-b'
      });

      const tokenA = generateAccessToken(userA as any);

      // User A tries to post as "Other Corp"
      const response = await request(app)
        .post('/api/posts')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('x-identity-id', 'other-company')
        .set('x-identity-type', 'company')
        .send({
          content: 'Company post',
          authorId: 'other-company',
          energy: '🪐 Neutral'
        });

      // Should be rejected because User A is not a member of 'other-company'
      expect(response.status).toBe(403);
    });
  });
});
