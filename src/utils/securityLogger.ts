import { Request } from 'express';
import { getDB } from '../db';

export type SecurityEventType =
  | 'login_failed'
  | 'login_success'
  | 'refresh_failed'
  | 'refresh_success'
  | 'webhook_signature_failed'
  | 'rate_limit_triggered'
  | 'payment_failure'
  | 'alert_login_spike';

interface SecurityEvent {
  type: SecurityEventType;
  timestamp: string;
  ip?: string;
  userId?: string;
  identifier?: string;
  route?: string;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

const LOGIN_WINDOW_MS = 60 * 1000;
const LOGIN_SPIKE_THRESHOLD = 20;

let loginWindowStart = Date.now();
let loginWindowCount = 0;

export async function logSecurityEvent(options: {
  req?: Request;
  type: SecurityEventType;
  userId?: string;
  identifier?: string;
  route?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const now = Date.now();
    const event: SecurityEvent = {
      type: options.type,
      timestamp: new Date(now).toISOString(),
      ip: options.req ? options.req.ip : undefined,
      userId: options.userId,
      identifier: options.identifier,
      route: options.route || (options.req ? options.req.originalUrl : undefined),
      userAgent: options.req ? options.req.get('User-Agent') || null : null,
      metadata: options.metadata
    };

    const db = getDB();
    await db.collection('securityEvents').insertOne(event);

    if (options.type === 'login_failed') {
      trackLoginSpike(now, event);
    }
  } catch (error) {
    console.error('Error logging security event', error);
  }
}

function trackLoginSpike(now: number, event: SecurityEvent): void {
  try {
    if (now - loginWindowStart > LOGIN_WINDOW_MS) {
      loginWindowStart = now;
      loginWindowCount = 0;
    }

    loginWindowCount += 1;

    if (loginWindowCount === LOGIN_SPIKE_THRESHOLD) {
      const alertEvent: SecurityEvent = {
        type: 'alert_login_spike',
        timestamp: new Date(now).toISOString(),
        ip: event.ip,
        userId: event.userId,
        identifier: event.identifier,
        route: event.route,
        userAgent: event.userAgent,
        metadata: {
          windowMs: LOGIN_WINDOW_MS,
          attempts: loginWindowCount
        }
      };

      const db = getDB();
      db.collection('securityEvents')
        .insertOne(alertEvent)
        .catch(err => {
          console.error('Error logging login spike alert', err);
        });
    }
  } catch (error) {
    console.error('Error tracking login spike', error);
  }
}

