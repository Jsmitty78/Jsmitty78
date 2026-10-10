import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
/** Test fixture only: never exported by the production package. */
export function scriptedStream(steps: Array<{name:string;arguments:Record<string,unknown>}>, observe?: (context: unknown)=>void): StreamFn {
  let index=0;
  return (_model,context)=>{
    observe?.(context);
    const stream=new AssistantMessageEventStream();
    const step=steps[index++];
    const message:AssistantMessage={role:'assistant',content:step ? [{type:'toolCall',id:`test-${index}`,name:step.name,arguments:JSON.parse(JSON.stringify(step.arguments))}] : [],api:'test',provider:'test',model:'test-only',stopReason:step?'toolUse':'stop',timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
    stream.push({type:'start',partial:message});
    stream.push({type:'done',reason:step?'toolUse':'stop',message});
    stream.end(message);return stream;
  };
}
