// Load environment variables for testing
require('dotenv').config();

const llmService = require('../src/services/llmService');
const conversationManager = require('../src/services/conversationManager');

describe('WhatsApp Chatbot Tests', () => {
  
  describe('Conversation Manager', () => {
    test('should create conversation and manage messages', () => {
      const conversationId = 'test-user-123';
      const conversation = conversationManager.getConversation(conversationId);
      
      conversation.addMessage('user', 'Hello, how are you?');
      conversation.addMessage('assistant', 'I\'m doing well, thank you for asking!');
      
      const messages = conversation.getMessages();
      
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('Hello, how are you?');
      expect(messages[1].role).toBe('assistant');
      expect(messages[1].content).toBe('I\'m doing well, thank you for asking!');
    });

    test('should provide conversation statistics', () => {
      const stats = conversationManager.getStats();
      
      expect(stats).toHaveProperty('totalConversations');
      expect(stats).toHaveProperty('totalMessages');
      expect(stats).toHaveProperty('averageMessagesPerConversation');
      expect(typeof stats.totalConversations).toBe('number');
      expect(typeof stats.totalMessages).toBe('number');
      expect(typeof stats.averageMessagesPerConversation).toBe('number');
    });
  });

  describe('LLM Service', () => {
    test('should have proper configuration', () => {
      const config = llmService.getConfig();
      
      expect(config).toHaveProperty('model');
      expect(config).toHaveProperty('maxTokens');
      expect(config).toHaveProperty('temperature');
      expect(typeof config.model).toBe('string');
      expect(typeof config.maxTokens).toBe('number');
      expect(typeof config.temperature).toBe('number');
    });

    test('should have a system prompt', () => {
      const systemPrompt = llmService.getSystemPrompt();
      
      expect(typeof systemPrompt).toBe('string');
      expect(systemPrompt.length).toBeGreaterThan(0);
      expect(systemPrompt.toLowerCase()).toContain('whatsapp');
    });

    test('should provide fallback responses', () => {
      const fallbackResponse = llmService.getFallbackResponse(new Error('Test error'));
      
      expect(typeof fallbackResponse).toBe('string');
      expect(fallbackResponse.length).toBeGreaterThan(0);
    });

    test('should handle missing API key gracefully', async () => {
      // This test assumes no API key is set for testing
      if (!process.env.OPENAI_API_KEY) {
        const conversationHistory = [];
        const testMessage = 'Hello';
        
        const response = await llmService.generateResponse(conversationHistory, testMessage);
        
        // Should return a fallback response when API key is missing
        expect(typeof response).toBe('string');
        expect(response.length).toBeGreaterThan(0);
      } else {
        // If API key is present, skip this test
        expect(true).toBe(true);
      }
    });
  });

});
