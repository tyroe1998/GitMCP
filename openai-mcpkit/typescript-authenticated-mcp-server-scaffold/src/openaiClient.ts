import OpenAI from 'openai';
import { config } from './config.js';

let cachedClient: OpenAI | undefined;

export function getOpenAIClient(): OpenAI {
  if (!cachedClient) {
    cachedClient = config.openAiApiKey ? new OpenAI({ apiKey: config.openAiApiKey }) : new OpenAI();
  }
  return cachedClient;
}
