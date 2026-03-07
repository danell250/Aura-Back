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
exports.savedJobsController = void 0;
const db_1 = require("../db");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const savedJobsService_1 = require("../services/savedJobsService");
exports.savedJobsController = {
    // POST /api/jobs/:jobId/save
    saveJob: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
            const db = (0, db_1.getDB)();
            const result = yield (0, savedJobsService_1.saveJobForUser)({
                db,
                currentUserId,
                jobId,
            });
            if (result.error || !result.state) {
                return res.status(result.statusCode || 500).json({
                    success: false,
                    error: result.error || 'Failed to save job',
                });
            }
            return res.status(result.created ? 201 : 200).json({
                success: true,
                data: result.state,
            });
        }
        catch (error) {
            console.error('Save job error:', error);
            return res.status(500).json({ success: false, error: 'Failed to save job' });
        }
    }),
    // DELETE /api/jobs/:jobId/save
    unsaveJob: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
            yield (0, savedJobsService_1.unsaveJobForUser)({
                db,
                currentUserId,
                jobId,
            });
            return res.json({
                success: true,
                data: {
                    jobId,
                    isSaved: false,
                    savedAt: null,
                    savedJobId: null,
                },
            });
        }
        catch (error) {
            console.error('Unsave job error:', error);
            return res.status(500).json({ success: false, error: 'Failed to unsave job' });
        }
    }),
    // GET /api/me/saved-jobs
    listMySavedJobs: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.json({
                    success: true,
                    data: [],
                    pagination: { page: 1, limit: 20, total: 0, pages: 0 },
                });
            }
            const currentUserId = (0, inputSanitizers_1.readString)((_a = req.user) === null || _a === void 0 ? void 0 : _a.id, 120);
            if (!currentUserId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const db = (0, db_1.getDB)();
            const payload = yield (0, savedJobsService_1.listSavedJobsForUser)({
                db,
                currentUserId,
                query: req.query || {},
            });
            return res.json({
                success: true,
                data: payload.data,
                pagination: payload.pagination,
            });
        }
        catch (error) {
            console.error('List saved jobs error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch saved jobs' });
        }
    }),
    // GET /api/me/saved-jobs/:jobId/status
    getMySavedJobStatus: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
            const state = yield (0, savedJobsService_1.getSavedJobStateForUser)({
                db,
                currentUserId,
                jobId,
            });
            return res.json({
                success: true,
                data: state || {
                    jobId,
                    isSaved: false,
                    savedAt: null,
                    savedJobId: null,
                },
            });
        }
        catch (error) {
            console.error('Get saved job status error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch saved job status' });
        }
    }),
};
