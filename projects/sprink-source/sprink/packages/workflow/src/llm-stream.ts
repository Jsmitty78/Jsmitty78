import type { StreamFn } from '@earendil-works/pi-agent-core';
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all';
import { stream as openAiStream } from '@earendil-works/pi-ai/api/openai-responses';
import { type Model } from '@earendil-works/pi-ai';

export interface WorkflowLlm {
  model: Model<'openai-responses'>;
  apiKey: string;
  /** Explicit comparison setting; production uses the default below. */
  reasoningEffort?: 'low' | 'medium';
}

export const WORKFLOW_LLM_MODEL_ID = 'gpt-6-astra';
export const WORKFLOW_LLM_REASONING_EFFORT = 'low';

export function workflowLlmFromEnv(env: NodeJS.ProcessEnv = process.env, localEnv: NodeJS.ProcessEnv = {}, modelId = WORKFLOW_LLM_MODEL_ID): WorkflowLlm {
  const apiKey = localEnv.OPENAI_API_KEY ?? env.OPENAI_API_KEY;
  if (!apiKey?.trim()) throw new Error('OPENAI_API_KEY is required for the workflow LLM');
  if (!['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna'].includes(modelId)) throw new Error('Unsupported workflow OpenAI Responses model');
  const model = getBuiltinModels('openai').find(m => m.id === modelId);
  if (!model || model.api !== 'openai-responses') throw new Error('Unsupported workflow OpenAI Responses model');
  return { model: model as Model<'openai-responses'>, apiKey, reasoningEffort: WORKFLOW_LLM_REASONING_EFFORT };
}

/** Tools and arguments are model-selected from Pi's full context. No fallback. */
export function astraStream(llm: WorkflowLlm): StreamFn {
  if (!['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna'].includes(llm.model.id) || llm.model.provider !== 'openai' || llm.model.api !== 'openai-responses') throw new Error('Unsupported workflow OpenAI Responses model');
  return (_model, context, options) => openAiStream(llm.model, context, {
    ...options, apiKey: llm.apiKey, maxTokens: 4096, reasoningEffort: llm.reasoningEffort ?? WORKFLOW_LLM_REASONING_EFFORT,
    toolChoice: 'auto', maxRetries: 0, serviceTier: 'default',
  });
}
