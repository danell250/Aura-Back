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
exports.jobNetworkController = void 0;
const db_1 = require("../db");
const jobNetworkService_1 = require("../services/jobNetworkService");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const JOBS_COLLECTION = 'jobs';
exports.jobNetworkController = {
    // GET /api/jobs/:jobId/network-count
    getJobNetworkCount: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const currentUserId = (0, inputSanitizers_1.readString)((_a = req.user) === null || _a === void 0 ? void 0 : _a.id, 120);
            if (!currentUserId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const jobId = (0, inputSanitizers_1.readString)(req.params.jobId, 120);
            if (!jobId) {
                return res.status(400).json({ success: false, error: 'jobId is required' });
            }
            const db = (0, db_1.getDB)();
            const job = yield db.collection(JOBS_COLLECTION).findOne({ id: jobId, status: { $ne: 'archived' } }, { projection: { companyId: 1 } });
            if (!job) {
                return res.status(404).json({ success: false, error: 'Job not found' });
            }
            const companyId = (0, inputSanitizers_1.readString)(job.companyId, 120);
            if (!companyId) {
                return res.json({ success: true, data: { count: 0, companyId: '' } });
            }
            const cachedCount = (0, jobNetworkService_1.readCachedCompanyNetworkCount)({
                companyId,
                viewerUserId: currentUserId,
            });
            if (cachedCount != null) {
                return res.json({
                    success: true,
                    data: {
                        count: cachedCount,
                        companyId,
                    },
                });
            }
            (0, jobNetworkService_1.scheduleCompanyNetworkCountRefresh)({
                db,
                companyId,
                viewerUserId: currentUserId,
            });
            return res.json({
                success: true,
                data: {
                    count: 0,
                    companyId,
                    pending: true,
                },
            });
        }
        catch (error) {
            console.error('Get job network count error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch network count' });
        }
    }),
};
