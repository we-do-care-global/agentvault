// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global
// Author: Emir Perla <emirperla96@gmail.com>  ORCID 0009-0009-8515-2727

export * from "./types.js";
export * from "./gemini.js";
export * from "./openai.js";
export * from "./anthropic.js";
export * from "./ollama.js";

import { GeminiAdapter } from "./gemini.js";
import { OpenAIAdapter } from "./openai.js";
import { AnthropicAdapter } from "./anthropic.js";
import { OllamaAdapter } from "./ollama.js";
import type { ProviderAdapter } from "./types.js";
import type { Provider } from "@we-do-care/agentvault-shared";

export const adapters: Record<Provider, ProviderAdapter> = {
  gemini: new GeminiAdapter(),
  openai: new OpenAIAdapter(),
  anthropic: new AnthropicAdapter(),
  ollama: new OllamaAdapter(),
};

export function adapterFor(provider: Provider): ProviderAdapter {
  const a = adapters[provider];
  if (!a) throw new Error(`unknown provider: ${provider}`);
  return a;
}
