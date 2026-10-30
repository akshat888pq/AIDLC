export interface ChatOptions {
  maxOutputTokens?: number;
  temperature?: number;
  /** Ask the provider to emit a bare JSON object. */
  json?: boolean;
}

export interface LLMAdapter {
  name: string;
  analyze(systemPrompt: string, userContent: string): Promise<string>;
  chat(
    systemPrompt: string,
    messages: { role: 'user' | 'model'; content: string }[],
    options?: ChatOptions
  ): Promise<string>;
  isConfigured(): boolean;
}

export function selectAdapter(adapters: LLMAdapter[]): LLMAdapter | null {
  return adapters.find((a) => a.isConfigured()) ?? null;
}
