import { JevSourceSearch } from './sources/semantic.js';
import { readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { workflowLlmFromEnv, JevHttpClient } from '@sprink/workflow';
import { serverConfig, accessToken } from './config.js';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { FieldService } from './service.js';
import { createApp } from './api.js';
import { WorkPackageStore } from './work-packages/store.js';
import { createIntegratedServices } from './integration/runtime.js';

const config = serverConfig(process.env, fileURLToPath(new URL('../../../.data/', import.meta.url)));
const { dataDir, hostname, port } = config;
mkdirSync(dataDir,{recursive:true,mode:0o700});chmodSync(dataDir,0o700);
const token = accessToken(dataDir, process.env.SPRINK_TOKEN);
// Local development credentials never override production environment secrets.
let localEnv: NodeJS.ProcessEnv = {};
try { if (!config.production) localEnv = parseEnv(readFileSync(fileURLToPath(new URL('../../../.env.local', import.meta.url)), 'utf8')); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
// Ask uses JEV and stored source text; unrelated workflow credentials must not block it.
const llm = (localEnv.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY)?.trim() ? workflowLlmFromEnv(process.env, localEnv) : undefined;
const jevKey = localEnv.TYPESAFE_API_KEY ?? process.env.TYPESAFE_API_KEY;
const sourceSearch = new JevSourceSearch(jevKey);
const service=new FieldService(dataDir);
const integrated=createIntegratedServices(new WorkPackageStore(service.store.db),dataDir,{llm,sourceSearch, ...(jevKey ? {choice: new JevHttpClient(jevKey)} : {})});
const app=createApp(service,{token,sourceSearch,workPackages:integrated.packages,workPackageExports:integrated.exports,workPackageDetails:integrated.details,webDir:fileURLToPath(new URL('../../web/dist/',import.meta.url))});
const server=serve({fetch:app.fetch,hostname,port},info=>{
  console.log(`Sprink: http://${hostname}:${info.port}`);
  console.log(`App token: ${process.env.SPRINK_TOKEN?'provided through environment':'stored in the data directory'}`);
});
let shuttingDown=false;
function shutdown(){
  if(shuttingDown)return;shuttingDown=true;
  const deadline=setTimeout(()=>{if('closeAllConnections' in server)server.closeAllConnections();},50_000);deadline.unref();
  server.close(()=>{clearTimeout(deadline);integrated.packages.close();service.store.close();});
}
process.on('SIGINT',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());
