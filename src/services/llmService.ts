import OpenAI from 'openai';

class LLMService {
  private openai: OpenAI | null;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  constructor() {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    } else {
      this.openai = null;
      console.warn('⚠️  OpenAI API key not found - LLM service will use fallback responses');
    }

    this.model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
    this.maxTokens = 1000;
    this.temperature = 0.7;
  }

  async generateResponse(
    conversationHistory: { role: string; content: string }[],
    currentMessage: string
  ): Promise<string> {
    try {
      if (!process.env.OPENAI_API_KEY || !this.openai) {
        throw new Error('OpenAI API key not configured');
      }

      const messages = this.prepareMessages(conversationHistory, currentMessage);

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
        max_tokens: this.maxTokens,
        temperature: this.temperature,
      });

      const aiResponse = response.choices[0]?.message?.content?.trim();
      if (!aiResponse) throw new Error('No response generated from AI');
      return aiResponse;
    } catch (error) {
      console.error('❌ Error generating AI response:', error);
      return this.getFallbackResponse(error as Error);
    }
  }

  private prepareMessages(
    conversationHistory: { role: string; content: string }[],
    currentMessage: string
  ): { role: string; content: string }[] {
    const messages: { role: string; content: string }[] = [
      { role: 'system', content: this.getSystemPrompt() },
    ];

    const recentHistory = conversationHistory.slice(-10);
    for (const message of recentHistory) {
      messages.push({ role: message.role, content: message.content });
    }

    if (currentMessage && !recentHistory.some((msg) => msg.content === currentMessage)) {
      messages.push({ role: 'user', content: currentMessage });
    }

    return messages;
  }

  private getSystemPrompt(): string {
    return `You are a helpful and friendly WhatsApp chatbot assistant.

Your role is to:
- Provide helpful, accurate, and engaging responses
- Be conversational and natural in your communication
- Keep responses concise but informative
- Be polite and professional
- Ask clarifying questions when needed
- Provide relevant information and assistance

Guidelines:
- Respond in a conversational tone
- Keep messages under 500 characters when possible
- Use emojis sparingly and appropriately
- If you don't know something, be honest about it
- Be helpful and supportive

Remember: You're chatting on WhatsApp, so keep responses friendly and accessible.`;
  }

  private getFallbackResponse(error: Error): string {
    const fallbackResponses = [
      "I'm having trouble processing your request right now. Could you try again in a moment?",
      "Sorry, I'm experiencing some technical difficulties. Please try again later.",
      "I'm not able to respond properly at the moment. Please try again.",
      "Something went wrong on my end. Could you rephrase your message?",
    ];
    console.error('Using fallback response due to error:', error.message);
    return fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
  }

  updateConfig(config: { model?: string; maxTokens?: number; temperature?: number }): void {
    if (config.model) this.model = config.model;
    if (config.maxTokens) this.maxTokens = config.maxTokens;
    if (config.temperature) this.temperature = config.temperature;
  }

  getConfig(): { model: string; maxTokens: number; temperature: number } {
    return { model: this.model, maxTokens: this.maxTokens, temperature: this.temperature };
  }
}

export default new LLMService();
