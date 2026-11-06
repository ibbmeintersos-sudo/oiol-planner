import { OpenAICompatibleProvider } from './openai-compatible.mjs';
import { AnthropicProvider } from './anthropic.mjs';
import { GeminiProvider } from './gemini.mjs';
import { OllamaProvider } from './ollama.mjs';
export function createProvider(config={}){
 const common={apiKey:config.apiKey,baseUrl:config.baseUrl,model:config.model,timeoutMs:config.timeoutMs};
 switch(config.provider||'openai-compatible'){
  case 'openai-compatible':return new OpenAICompatibleProvider(common);
  case 'anthropic':return new AnthropicProvider(common);
  case 'gemini':return new GeminiProvider(common);
  case 'ollama':return new OllamaProvider(common);
  default:throw new Error(`Unknown provider: ${config.provider}`);
 }
}
