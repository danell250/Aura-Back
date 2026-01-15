"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const shareController_1 = require("../controllers/shareController");
const router = express_1.default.Router();
// Route for sharing posts: /share/p/:id
router.get('/p/:id', shareController_1.shareController.getPostShare);
exports.default = router;
