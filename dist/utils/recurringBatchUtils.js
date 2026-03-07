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
exports.runSettledConcurrentChunks = exports.runSettledBatches = void 0;
const asyncUtils_1 = require("./asyncUtils");
const runSettledBatches = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const fulfilled = [];
    for (let start = 0; start < params.items.length; start += params.batchSize) {
        const batch = params.items.slice(start, start + params.batchSize);
        const settled = yield Promise.allSettled(batch.map((item) => params.worker(item)));
        settled.forEach((result, index) => {
            var _a, _b;
            const item = batch[index];
            if (result.status === 'rejected') {
                (_a = params.onRejected) === null || _a === void 0 ? void 0 : _a.call(params, result.reason, item);
                return;
            }
            fulfilled.push(result.value);
            (_b = params.onFulfilled) === null || _b === void 0 ? void 0 : _b.call(params, result.value, item);
        });
        yield (0, asyncUtils_1.yieldToEventLoop)();
    }
    return fulfilled;
});
exports.runSettledBatches = runSettledBatches;
const runSettledConcurrentChunks = (params) => __awaiter(void 0, void 0, void 0, function* () {
    for (let start = 0; start < params.items.length; start += params.concurrency) {
        const chunk = params.items.slice(start, start + params.concurrency);
        const settled = yield Promise.allSettled(chunk.map((item) => params.worker(item)));
        settled.forEach((result, index) => {
            var _a;
            if (result.status === 'rejected') {
                (_a = params.onRejected) === null || _a === void 0 ? void 0 : _a.call(params, result.reason, chunk[index]);
            }
        });
        yield (0, asyncUtils_1.yieldToEventLoop)();
    }
});
exports.runSettledConcurrentChunks = runSettledConcurrentChunks;
