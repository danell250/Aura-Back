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
exports.jobMarketDemandController = void 0;
const db_1 = require("../db");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const jobMarketDemandService_1 = require("../services/jobMarketDemandService");
const parseRoleFilters = (req) => {
    var _a, _b;
    const singleRole = (0, inputSanitizers_1.readString)((_a = req.query) === null || _a === void 0 ? void 0 : _a.role, 140);
    const multipleRoles = (0, inputSanitizers_1.readString)((_b = req.query) === null || _b === void 0 ? void 0 : _b.roles, 1200);
    const values = [
        ...(singleRole ? [singleRole] : []),
        ...multipleRoles.split(','),
    ];
    const deduped = new Set();
    const roles = [];
    values.forEach((value) => {
        const normalized = (0, inputSanitizers_1.readString)(value, 140);
        if (!normalized)
            return;
        const cacheKey = normalized.toLowerCase();
        if (deduped.has(cacheKey))
            return;
        deduped.add(cacheKey);
        roles.push(normalized);
    });
    return roles.slice(0, 10);
};
exports.jobMarketDemandController = {
    // GET /api/jobs/market-demand
    getJobMarketDemand: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const db = (0, db_1.getDB)();
            const location = (0, inputSanitizers_1.readString)((_a = req.query) === null || _a === void 0 ? void 0 : _a.location, 120);
            const workModelRaw = (0, inputSanitizers_1.readString)((_b = req.query) === null || _b === void 0 ? void 0 : _b.workModel, 20).toLowerCase();
            const workModel = workModelRaw === 'all' ? '' : workModelRaw;
            const roles = parseRoleFilters(req);
            const limit = (0, inputSanitizers_1.parsePositiveInt)((_c = req.query) === null || _c === void 0 ? void 0 : _c.limit, 6, 1, 12);
            const isScopedDemandQuery = Boolean(location || workModel || roles.length > 0);
            const marketDemand = yield (0, jobMarketDemandService_1.listJobMarketDemand)({
                db,
                query: {
                    location,
                    workModel,
                    roles,
                    limit,
                },
                personalized: isScopedDemandQuery,
            });
            return res.json({
                success: true,
                data: marketDemand.entries,
                meta: marketDemand.meta,
            });
        }
        catch (error) {
            console.error('Get job market demand error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch job market demand' });
        }
    }),
};
