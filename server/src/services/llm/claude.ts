import type { LLMAdapter } from './adapter.js';

export class ClaudeAdapter implements LLMAdapter {
  name = 'claude';

  isConfigured(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  async analyze(_systemPrompt: string, _userContent: string): Promise<string> {
    throw new Error('Claude adapter not yet implemented. Set GEMINI_API_KEY to use the Gemini adapter.');
  }

  async chat(
    _systemPrompt: string,
    _messages: { role: 'user' | 'model'; content: string }[]
  ): Promise<string> {
    throw new Error('Claude adapter not yet implemented.');
  }
}
