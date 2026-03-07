"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.yieldToEventLoop = void 0;
const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));
exports.yieldToEventLoop = yieldToEventLoop;
