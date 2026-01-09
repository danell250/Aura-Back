import express from 'express';
import { getDB } from '../db';
import { ObjectId } from 'mongodb';

const router = express.Router();

// Get all posts
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const posts = await db.collection("posts").find({}).sort({ createdAt: -1 }).toArray();
    res.json(posts);
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

// Create a new post
router.post('/', async (req, res) => {
  try {
    const db = getDB();
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
    
    const result = await db.collection("posts").insertOne(newPost);
    res.json({ ...newPost, _id: result.insertedId });
  } catch (error) {
    console.error('Error creating post:', error);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// Get a single post
router.get('/:id', async (req, res) => {
  try {
    const db = getDB();
    const post = await db.collection("posts").findOne({ _id: new ObjectId(req.params.id) });
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    res.json(post);
  } catch (error) {
    console.error('Error fetching post:', error);
    res.status(500).json({ error: 'Failed to fetch post' });
  }
});

// Update a post
router.put('/:id', async (req, res) => {
  try {
    const db = getDB();
    const { content, mediaUrl, mediaType } = req.body;
    
    const updateData = {
      ...(content && { content }),
      ...(mediaUrl && { mediaUrl }),
      ...(mediaType && { mediaType }),
      updatedAt: new Date()
    };
    
    const result = await db.collection("posts").updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: updateData }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    res.json({ message: 'Post updated successfully' });
  } catch (error) {
    console.error('Error updating post:', error);
    res.status(500).json({ error: 'Failed to update post' });
  }
});

// Delete a post
router.delete('/:id', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection("posts").deleteOne({ _id: new ObjectId(req.params.id) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    console.error('Error deleting post:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

// Add comment to post
router.post('/:id/comments', async (req, res) => {
  try {
    const db = getDB();
    const { author, text } = req.body;
    
    const newComment = {
      _id: new ObjectId(),
      author,
      text,
      createdAt: new Date(),
      reactions: {}
    };
    
    const result = await db.collection("posts").updateOne(
      { _id: new ObjectId(req.params.id) },
      { 
        $push: { comments: newComment as any },
        $set: { updatedAt: new Date() }
      }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    res.json(newComment);
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

export default router;
