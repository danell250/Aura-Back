import mongoose, { Document, Schema } from 'mongoose';

export interface IMessage extends Document {
  senderId: string;
  receiverId: string;
  text: string;
  timestamp: Date;
  isRead: boolean;
  messageType: 'text' | 'image' | 'file';
  mediaUrl?: string;
  replyTo?: string; // For threaded conversations
  isEdited: boolean;
  editedAt?: Date;
}

const MessageSchema = new Schema<IMessage>({
  senderId: {
    type: String,
    required: true,
    index: true
  },
  receiverId: {
    type: String,
    required: true,
    index: true
  },
  text: {
    type: String,
    required: true,
    maxlength: 2000
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  isRead: {
    type: Boolean,
    default: false,
    index: true
  },
  messageType: {
    type: String,
    enum: ['text', 'image', 'file'],
    default: 'text'
  },
  mediaUrl: {
    type: String,
    required: false
  },
  replyTo: {
    type: String,
    required: false
  },
  isEdited: {
    type: Boolean,
    default: false
  },
  editedAt: {
    type: Date,
    required: false
  }
});

// Compound indexes for efficient queries
MessageSchema.index({ senderId: 1, receiverId: 1, timestamp: -1 });
MessageSchema.index({ receiverId: 1, isRead: 1 });

export const Message = mongoose.model<IMessage>('Message', MessageSchema);