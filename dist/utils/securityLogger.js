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
exports.logSecurityEvent = logSecurityEvent;
const db_1 = require("../db");
const LOGIN_WINDOW_MS = 60 * 1000;
const LOGIN_SPIKE_THRESHOLD = 20;
let loginWindowStart = Date.now();
let loginWindowCount = 0;
function logSecurityEvent(options) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const now = Date.now();
            const event = {
                type: options.type,
                timestamp: new Date(now).toISOString(),
                ip: options.req ? options.req.ip : undefined,
                userId: options.userId,
                identifier: options.identifier,
                route: options.route || (options.req ? options.req.originalUrl : undefined),
                userAgent: options.req ? options.req.get('User-Agent') || null : null,
                metadata: options.metadata
            };
            const db = (0, db_1.getDB)();
            yield db.collection('securityEvents').insertOne(event);
            if (options.type === 'login_failed') {
                trackLoginSpike(now, event);
            }
        }
        catch (error) {
            console.error('Error logging security event', error);
        }
    });
}
function trackLoginSpike(now, event) {
    try {
        if (now - loginWindowStart > LOGIN_WINDOW_MS) {
            loginWindowStart = now;
            loginWindowCount = 0;
        }
        loginWindowCount += 1;
        if (loginWindowCount === LOGIN_SPIKE_THRESHOLD) {
            const alertEvent = {
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
            const db = (0, db_1.getDB)();
            db.collection('securityEvents')
                .insertOne(alertEvent)
                .catch(err => {
                console.error('Error logging login spike alert', err);
            });
        }
    }
    catch (error) {
        console.error('Error tracking login spike', error);
    }
}
