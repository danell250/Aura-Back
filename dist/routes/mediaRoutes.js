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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const crypto_1 = __importDefault(require("crypto"));
const s3Service_1 = require("../services/s3Service");
const router = express_1.default.Router();
router.post("/media/upload-url", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { userId, fileName, contentType, folder = "posts" } = req.body;
        if (!userId || !fileName || !contentType) {
            return res.status(400).json({ success: false, error: "Missing fields" });
        }
        const ext = fileName.split(".").pop() || "bin";
        const id = crypto_1.default.randomBytes(12).toString("hex");
        // Key structure: posts/<userId>/<id>.<ext> 
        const key = `${folder}/${userId}/${id}.${ext}`;
        const result = yield (0, s3Service_1.getUploadUrl)({ key, contentType });
        res.json(Object.assign(Object.assign({ success: true }, result), { key }));
    }
    catch (e) {
        console.error("upload-url error", e);
        res.status(500).json({ success: false, error: "Failed to create upload URL" });
    }
}));
exports.default = router;
