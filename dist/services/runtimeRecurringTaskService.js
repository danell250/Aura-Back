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
exports.runLockedRecurringTask = exports.startRecurringTaskRunner = void 0;
const db_1 = require("../db");
const runtimeJobLockService_1 = require("./runtimeJobLockService");
const startRecurringTaskRunner = (params) => {
    const loop = () => __awaiter(void 0, void 0, void 0, function* () {
        try {
            yield params.run();
        }
        finally {
            setTimeout(() => {
                void loop();
            }, params.intervalMs);
        }
    });
    void loop();
};
exports.startRecurringTaskRunner = startRecurringTaskRunner;
const runLockedRecurringTask = (params) => __awaiter(void 0, void 0, void 0, function* () {
    if (!(0, db_1.isDBConnected)())
        return null;
    const db = (0, db_1.getDB)();
    return (0, runtimeJobLockService_1.withRuntimeJobLock)({
        db,
        jobKey: params.jobKey,
        ttlMs: params.ttlMs,
        task: () => params.task(db),
    });
});
exports.runLockedRecurringTask = runLockedRecurringTask;
