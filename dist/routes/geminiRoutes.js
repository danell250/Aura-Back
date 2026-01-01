"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const geminiController_1 = require("../controllers/geminiController");
const router = express_1.default.Router();
router.post('/inspiration', geminiController_1.generatePostInspiration);
router.post('/reply', geminiController_1.suggestReply);
router.post('/birthday', geminiController_1.generateQuirkyBirthdayWish);
router.post('/analyze', geminiController_1.analyzeDataAura);
exports.default = router;
