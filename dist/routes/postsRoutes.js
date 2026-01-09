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
const db_1 = require("../db");
const mongodb_1 = require("mongodb");
const router = express_1.default.Router();
// Get all posts
router.get('/', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const db = (0, db_1.getDB)();
        const posts = yield db.collection("posts").find({}).sort({ createdAt: -1 }).toArray();
        res.json(posts);
    }
    catch (error) {
        console.error('Error fetching posts:', error);
        res.status(500).json({ error: 'Failed to fetch posts' });
    }
}));
// Create a new post
router.post('/', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const db = (0, db_1.getDB)();
        const { author, content, mediaUrl, mediaType, reactions, comments } = req.body;
        const newPost = {
            author,
            content,
            mediaUrl: mediaUrl || null,
            mediaType: mediaType || null,
            reactions: reactions || {},
            comments: comments || [],
            createdAt: new Date(),
            updatedAt: new Date()
        };
        const result = yield db.collection("posts").insertOne(newPost);
        res.json(Object.assign(Object.assign({}, newPost), { _id: result.insertedId }));
    }
    catch (error) {
        console.error('Error creating post:', error);
        res.status(500).json({ error: 'Failed to create post' });
    }
}));
// Get a single post
router.get('/:id', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const db = (0, db_1.getDB)();
        const post = yield db.collection("posts").findOne({ _id: new mongodb_1.ObjectId(req.params.id) });
        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }
        res.json(post);
    }
    catch (error) {
        console.error('Error fetching post:', error);
        res.status(500).json({ error: 'Failed to fetch post' });
    }
}));
// Update a post
router.put('/:id', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const db = (0, db_1.getDB)();
        const { content, mediaUrl, mediaType } = req.body;
        const updateData = Object.assign(Object.assign(Object.assign(Object.assign({}, (content && { content })), (mediaUrl && { mediaUrl })), (mediaType && { mediaType })), { updatedAt: new Date() });
        const result = yield db.collection("posts").updateOne({ _id: new mongodb_1.ObjectId(req.params.id) }, { $set: updateData });
        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Post not found' });
        }
        res.json({ message: 'Post updated successfully' });
    }
    catch (error) {
        console.error('Error updating post:', error);
        res.status(500).json({ error: 'Failed to update post' });
    }
}));
// Delete a post
router.delete('/:id', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const db = (0, db_1.getDB)();
        const result = yield db.collection("posts").deleteOne({ _id: new mongodb_1.ObjectId(req.params.id) });
        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Post not found' });
        }
        res.json({ message: 'Post deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting post:', error);
        res.status(500).json({ error: 'Failed to delete post' });
    }
}));
// Add comment to post
router.post('/:id/comments', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const db = (0, db_1.getDB)();
        const { author, text } = req.body;
        const newComment = {
            _id: new mongodb_1.ObjectId(),
            author,
            text,
            createdAt: new Date(),
            reactions: {}
        };
        const result = yield db.collection("posts").updateOne({ _id: new mongodb_1.ObjectId(req.params.id) }, {
            $push: { comments: newComment },
            $set: { updatedAt: new Date() }
        });
        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Post not found' });
        }
        res.json(newComment);
    }
    catch (error) {
        console.error('Error adding comment:', error);
        res.status(500).json({ error: 'Failed to add comment' });
    }
}));
exports.default = router;
