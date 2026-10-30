import OpenAI from 'openai';
import type { LLMAdapter } from './adapter.js';

export class OpenAIAdapter implements LLMAdapter {
  name = 'openai';
  private modelName = 'gpt-4o-mini';

  private getClient(): OpenAI | null {
    const key = process.env.OPENAI_API_KEY;
    return key ? new OpenAI({ apiKey: key }) : null;
  }

  isConfigured(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  async analyze(systemPrompt: string, userContent: string): Promise<string> {
    const client = this.getClient();
    if (!client) throw new Error('OpenAI API key not configured');

    const response = await client.chat.completions.create({
      model: this.modelName,
      temperature: 0.2,
      max_tokens: 8192,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `DOCUMENTS:\n${userContent}` },
      ],
    });

    return response.choices[0]?.message?.content ?? '';
  }

  async chat(
    systemPrompt: string,
    messages: { role: 'user' | 'model'; content: string }[]
  ): Promise<string> {
    const client = this.getClient();
    if (!client) throw new Error('OpenAI API key not configured');

    const response = await client.chat.completions.create({
      model: this.modelName,
      temperature: 0.3,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({
          role: (m.role === 'model' ? 'assistant' : 'user') as 'assistant' | 'user',
          content: m.content,
        })),
      ],
    });

    return response.choices[0]?.message?.content ?? '';
  }
}
