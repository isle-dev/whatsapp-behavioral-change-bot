import { v4 as uuidv4 } from 'uuid';

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  timestamp: Date;
}

interface ConversationSummary {
  id: string;
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  createdAt: Date;
  lastActivity: Date;
  duration: number;
}

interface ConversationStats {
  totalConversations: number;
  totalMessages: number;
  averageMessagesPerConversation: number;
}

class Conversation {
  id: string;
  messages: ChatMessage[];
  createdAt: Date;
  lastActivity: Date;

  constructor(id: string) {
    this.id = id;
    this.messages = [];
    this.createdAt = new Date();
    this.lastActivity = new Date();
  }

  addMessage(role: string, content: string): ChatMessage {
    const message: ChatMessage = {
      id: uuidv4(),
      role,
      content,
      timestamp: new Date(),
    };

    this.messages.push(message);
    this.lastActivity = new Date();

    if (this.messages.length > 20) {
      this.messages = this.messages.slice(-20);
    }

    return message;
  }

  getMessages(): { role: string; content: string }[] {
    return this.messages.map((msg) => ({ role: msg.role, content: msg.content }));
  }

  getFullMessages(): ChatMessage[] {
    return this.messages;
  }

  getLastMessage(): ChatMessage | null {
    return this.messages.length > 0 ? this.messages[this.messages.length - 1] : null;
  }

  getMessageCount(): number {
    return this.messages.length;
  }

  clear(): void {
    this.messages = [];
    this.lastActivity = new Date();
  }

  getSummary(): ConversationSummary {
    const userMessages = this.messages.filter((msg) => msg.role === 'user').length;
    const assistantMessages = this.messages.filter((msg) => msg.role === 'assistant').length;
    return {
      id: this.id,
      totalMessages: this.messages.length,
      userMessages,
      assistantMessages,
      createdAt: this.createdAt,
      lastActivity: this.lastActivity,
      duration: this.lastActivity.getTime() - this.createdAt.getTime(),
    };
  }
}

class ConversationManager {
  conversations: Map<string, Conversation>;
  maxHistoryLength: number;

  constructor() {
    this.conversations = new Map();
    this.maxHistoryLength = 20;
  }

  getConversation(conversationId: string): Conversation {
    if (!this.conversations.has(conversationId)) {
      this.conversations.set(conversationId, new Conversation(conversationId));
    }
    return this.conversations.get(conversationId)!;
  }

  addMessage(conversationId: string, role: string, content: string): Conversation {
    const conversation = this.getConversation(conversationId);
    conversation.addMessage(role, content);
    return conversation;
  }

  getConversationHistory(conversationId: string): { role: string; content: string }[] {
    const conversation = this.getConversation(conversationId);
    return conversation.getMessages();
  }

  clearConversation(conversationId: string): boolean {
    if (this.conversations.has(conversationId)) {
      this.conversations.delete(conversationId);
      return true;
    }
    return false;
  }

  getAllConversations(): Record<string, { id: string; messageCount: number; lastActivity: Date; createdAt: Date }> {
    const conversations: Record<string, { id: string; messageCount: number; lastActivity: Date; createdAt: Date }> = {};
    for (const [id, conversation] of this.conversations) {
      conversations[id] = {
        id: conversation.id,
        messageCount: conversation.messages.length,
        lastActivity: conversation.lastActivity,
        createdAt: conversation.createdAt,
      };
    }
    return conversations;
  }

  cleanupOldConversations(): void {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    for (const [id, conversation] of this.conversations) {
      if (conversation.lastActivity < oneDayAgo) {
        this.conversations.delete(id);
        console.log(`🧹 Cleaned up old conversation: ${id}`);
      }
    }
  }

  getStats(): ConversationStats {
    const totalConversations = this.conversations.size;
    let totalMessages = 0;

    for (const conversation of this.conversations.values()) {
      totalMessages += conversation.messages.length;
    }

    return {
      totalConversations,
      totalMessages,
      averageMessagesPerConversation:
        totalConversations > 0 ? Math.round(totalMessages / totalConversations) : 0,
    };
  }
}

const conversationManager = new ConversationManager();

setInterval(() => {
  conversationManager.cleanupOldConversations();
}, 60 * 60 * 1000);

export default conversationManager;
