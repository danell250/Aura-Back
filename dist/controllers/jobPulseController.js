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
exports.jobPulseController = void 0;
const db_1 = require("../db");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const jobPulseSnapshotService_1 = require("../services/jobPulseSnapshotService");
const parseRequestedJobIds = (req) => {
    var _a, _b;
    const single = (0, inputSanitizers_1.readString)((_a = req.query) === null || _a === void 0 ? void 0 : _a.jobId, 120);
    const multiple = (0, inputSanitizers_1.readString)((_b = req.query) === null || _b === void 0 ? void 0 : _b.jobIds, 4000);
    const rawValues = [
        ...(single ? [single] : []),
        ...multiple.split(','),
    ];
    const seen = new Set();
    const jobIds = [];
    rawValues.forEach((rawValue) => {
        const normalized = (0, inputSanitizers_1.readString)(rawValue, 120);
        if (!normalized || seen.has(normalized))
            return;
        seen.add(normalized);
        jobIds.push(normalized);
    });
    return jobIds.slice(0, 20);
};
exports.jobPulseController = {
    // GET /api/jobs/pulse
    getJobsPulse: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.json({
                    success: true,
                    data: [],
                    meta: {
                        generatedAt: new Date().toISOString(),
                    },
                });
            }
            const jobIds = parseRequestedJobIds(req);
            const limit = (0, inputSanitizers_1.parsePositiveInt)((_a = req.query) === null || _a === void 0 ? void 0 : _a.limit, 20, 1, 20);
            const db = (0, db_1.getDB)();
            const snapshots = yield (0, jobPulseSnapshotService_1.listJobPulseSnapshots)({
                db,
                requestedJobIds: jobIds,
                limit,
            });
            return res.json({
                success: true,
                data: snapshots,
                meta: {
                    generatedAt: new Date().toISOString(),
                    recommendedPollingIntervalSeconds: 30,
                    windows: {
                        applicationsLast24hHours: 24,
                        viewsLast60mMinutes: 60,
                        matchesLast10mMinutes: 10,
                        savesLast24hHours: 24,
                    },
                },
            });
        }
        catch (error) {
            console.error('Get jobs pulse error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch jobs pulse' });
        }
    }),
};
