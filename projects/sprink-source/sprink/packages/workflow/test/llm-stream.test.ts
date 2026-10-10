import {expect,it} from 'vitest';
import {astraStream, workflowLlmFromEnv} from '../src/llm-stream.js';
it('uses project-local credentials ahead of inherited credentials and fixes Astra',()=>{
  const llm=workflowLlmFromEnv({OPENAI_API_KEY:'inherited-test'},{OPENAI_API_KEY:'project-test'});
  expect(llm.apiKey).toBe('project-test');expect(llm.model.id).toBe('gpt-6-astra');expect(llm.model.api).toBe('openai-responses');
  expect(llm.reasoningEffort).toBe('low');
});
it('rejects an alternate model instead of falling back',()=>{
  const llm=workflowLlmFromEnv({OPENAI_API_KEY:'test'});
  expect(()=>astraStream({...llm,model:{...llm.model,id:'other-model'}})).toThrow('Unsupported workflow OpenAI Responses model');
});
it('allows explicit comparison models without accepting environment model overrides',()=>{
  for (const id of ['gpt-6-sol','gpt-6-luna']) {
    const llm=workflowLlmFromEnv({OPENAI_API_KEY:'test'}, {}, id);
    expect(llm.model.id).toBe(id);
    expect(()=>astraStream({...llm,reasoningEffort:'medium'})).not.toThrow();
  }
  expect(workflowLlmFromEnv({OPENAI_API_KEY:'test',OPENAI_MODEL:'gpt-6-luna'}).model.id).toBe('gpt-6-astra');
});
