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
exports.uploadToSupabase = uploadToSupabase;
const supabaseClient_1 = require("../supabaseClient");
function uploadToSupabase(bucket, path, fileBuffer, contentType) {
    return __awaiter(this, void 0, void 0, function* () {
        const { error } = yield supabaseClient_1.supabaseAdmin.storage
            .from(bucket)
            .upload(path, fileBuffer, {
            contentType,
            upsert: true
        });
        if (error)
            throw error;
        const { data } = supabaseClient_1.supabaseAdmin.storage.from(bucket).getPublicUrl(path);
        return data.publicUrl;
    });
}
