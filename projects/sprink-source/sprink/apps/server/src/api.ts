import type { SourceSearch } from './sources/semantic.js';
import { planSvg } from './drawing.js';
import { Hono } from 'hono';
import { exportRoutes } from './exports/routes.js';
import type { WorkPackageExports } from './exports/service.js';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import { serveStatic } from '@hono/node-server/serve-static';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { RULE, ADOPTED_RULES, SfProjectFactsSchema, RuleContextSchema, checkSchema, resolveSfNfpa13Edition, evaluateProject } from '@sprink/core';
import { AppError, type Observation } from './models.js';
import { FieldService, safeId } from './service.js';
import { defaultWorkPackages, workPackageRouter } from './work-packages/router.js';
import type { WorkPackageService } from './work-packages/service.js';
import { SourceStore } from './sources/store.js';
import { sourceRouter } from './sources/router.js';
import { UploadService } from './uploads/service.js';
import { uploadRouter } from './uploads/router.js';

/** Serialize asynchronous upload/replay operations for each task, including retry races. */
class TaskCommands {
  private tails=new Map<string,Promise<unknown>>();
  async run<T>(id:string,fn:()=>T|Promise<T>):Promise<T> {
    const prior=this.tails.get(id)??Promise.resolve();
    const next=prior.catch(()=>{}).then(fn);this.tails.set(id,next);
    try {return await next;} finally {if(this.tails.get(id)===next)this.tails.delete(id);}
  }
}
export function createApp(service:FieldService,options:{token:string;webDir?:string;workPackages?:WorkPackageService;workPackageExports?:WorkPackageExports;workPackageDetails?:(id:string)=>unknown;sources?:SourceStore;uploads?:UploadService;sourceSearch?:SourceSearch}) {
  if(options.token.length<16) throw new Error('Application token must contain at least 16 characters');
  const app=new Hono(), commands=new TaskCommands();
  app.use('*',async(c,next)=>{await next();c.header('X-Content-Type-Options','nosniff');c.header('Referrer-Policy','no-referrer');});
  app.use('/api/*',async(c,next)=>{
    const actual=Buffer.from(c.req.header('Authorization')??''),expected=Buffer.from(`Bearer ${options.token}`);
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return c.json({error:'A valid access token is required.',code:'authentication_required'},401);
    c.header('Cache-Control','no-store');await next();
  });
  app.get('/health',c=>{c.header('Cache-Control','no-store');return c.json({ok:true});});
  const questionLimit=bodyLimit({maxSize:32*1024,onError:c=>c.json({error:'The question request is too large.',code:'invalid_question'},413)});
  app.use('/api/ask',questionLimit);
  app.use('/api/rules/search',questionLimit);
  // File uploads carry their own, larger limit (uploads/router.ts).
  const apiLimit=bodyLimit({maxSize:21*1024*1024,onError:c=>c.json({error:'送信データが大きすぎます'},413)});
  app.use('/api/*',(c,next)=>c.req.method==='POST'&&c.req.path==='/api/uploads'?next():apiLimit(c,next));
  const op=(header:string|undefined)=>safeId(header??randomUUID());
  app.get('/api/health',c=>c.json({ok:true,ruleId:RULE.id}));
  app.get('/api/rules',c=>c.json(ADOPTED_RULES));
  app.post('/api/rules/evaluate',async c=>{
    const input=await c.req.json();
    try { return c.json(evaluateProject(input)); }
    catch(error) {
      if(error instanceof Error&&error.name==='ProjectInputError')throw new AppError(400,error.message);
      throw error;
    }
  });
  // Stateless edition lookup; it neither sets a task's adopted code nor returns compliance.
  app.post('/api/rules/san-francisco/resolve-edition',async c=>{
    const input=await c.req.json();
    if(!input||!checkSchema(SfProjectFactsSchema,input.facts)||!checkSchema(RuleContextSchema,input.context))
      throw new AppError(400,'許可情報と根拠の形式が不正です');
    return c.json(resolveSfNfpa13Edition(input.facts,input.context));
  });
  app.get('/api/tasks',c=>c.json(service.listTasks()));
  app.post('/api/tasks',async c=>{
    const body=await c.req.json();
    if(!body||typeof body!=='object'||Array.isArray(body))throw new AppError(400,'仕事の形式が不正です');
    const input={id:body.id??op(c.req.header('Idempotency-Key')),title:body.title,planOrientation:body.planOrientation,reference:body.reference===true};
    return c.json(service.createTask(input),201);
  });
  app.get('/api/tasks/:id',c=>c.json(service.getTask(c.req.param('id'))));
  app.post('/api/tasks/:id/plan',async c=>{
    const input=await c.req.json(),id=c.req.param('id');
    return c.json(await commands.run(id,()=>service.updatePlan(id,input.orientation,input.baseRevision,op(c.req.header('Idempotency-Key')))));
  });
  app.get('/api/tasks/:id/drawing.svg',c=>{
    const task=service.getTask(c.req.param('id'));
    c.header('Content-Type','image/svg+xml; charset=utf-8');
    return c.body(planSvg(task.plan));
  });
  app.post('/api/tasks/:id/drawing',async c=>{
    const input=await c.req.json(),id=c.req.param('id');
    if(!input||typeof input!=='object')throw new AppError(400,'図面の形式が不正です');
    return c.json(await commands.run(id,()=>service.updateDrawing(id,input.drawing,input.baseRevision,op(c.req.header('Idempotency-Key')))));
  });
  app.post('/api/tasks/:id/observations',async c=>{
    const body=await c.req.parseBody(),id=c.req.param('id');
    if(typeof body.metadata!=='string'||!body.image||typeof body.image==='string'||Array.isArray(body.image))throw new AppError(400,'metadataとimageが必要です');
    const raw=JSON.parse(body.metadata);
    if(!raw||typeof raw!=='object')throw new AppError(400,'metadataが不正です');
    const metadata:Omit<Observation,'assetId'|'originalAssetId'|'digest'|'width'|'height'>={id:raw.id,targetId:raw.targetId,capturedAt:raw.capturedAt,source:raw.source,synthetic:raw.synthetic,...(raw.spatial?{spatial:raw.spatial}:{})};
    const bytes=Buffer.from(await body.image.arrayBuffer());
    return c.json(await commands.run(id,()=>service.addObservation(id,metadata,bytes)),201);
  });
  app.get('/api/tasks/:id/assets/:assetId',async c=>{
    const a=await service.asset(c.req.param('id'),c.req.param('assetId'));
    c.header('Content-Type',a.mimeType);
    if(a.mimeType==='application/octet-stream')c.header('Content-Disposition','attachment');
    return c.body(new Uint8Array(a.bytes));
  });
  app.post('/api/tasks/:id/facts',async c=>{
    const input=await c.req.json(),id=c.req.param('id');
    return c.json(await commands.run(id,()=>service.reviewFacts(id,input,op(c.req.header('Idempotency-Key')))));
  });
  app.post('/api/tasks/:id/measurements',async c=>{
    const input=await c.req.json(),id=c.req.param('id');
    return c.json(await commands.run(id,()=>service.addMeasurement(id,input)),201);
  });
  app.post('/api/tasks/:id/requests',async c=>{
    const input=await c.req.json(),id=c.req.param('id');
    return c.json(await commands.run(id,()=>service.requestEvidence(id,input,op(c.req.header('Idempotency-Key')))),201);
  });
  app.post('/api/tasks/:id/answers',async c=>{
    const input=await c.req.json(),id=c.req.param('id');
    const result=await commands.run(id,()=>service.answer(id,input));
    return c.json(result);
  });
  app.post('/api/tasks/:id/validate',async c=>c.json(await commands.run(c.req.param('id'),()=>service.validateTask(c.req.param('id')))));
  app.post('/api/tasks/:id/artifact',async c=>c.json(await commands.run(c.req.param('id'),()=>service.prepareArtifact(c.req.param('id'),op(c.req.header('Idempotency-Key'))))));
  app.get('/api/tasks/:id/artifact',c=>{
    const task=service.getTask(c.req.param('id'));
    if(!task.artifact||task.artifact.taskRevision!==task.revision)throw new AppError(409,'現行版の資料はまだありません');
    return c.json({...task.artifact,plan:{...task.artifact.plan,svg:planSvg(task.artifact.plan)}});
  });
  app.post('/api/tasks/:id/replay',async c=>{
    const input=await c.req.json(),id=c.req.param('id');
    const result=await commands.run(id,()=>service.replay(id,input.scenario,input.phase??'initial'));
    return c.json(result);
  });
  app.post('/api/tasks/:id/cancel',c=>c.json(service.cancel(c.req.param('id'))));
  app.get('/api/tasks/:id/events',c=>{
    const id=c.req.param('id');service.getTask(id);
    let cursor=Number(c.req.header('Last-Event-ID')??c.req.query('after')??0);
    if(!Number.isSafeInteger(cursor)||cursor<0)throw new AppError(400,'イベント番号が不正です');
    return streamSSE(c,async stream=>{
      while(!stream.aborted) {
        const events=service.store.events(id,cursor);
        for(const event of events) {await stream.writeSSE({id:String(event.id),event:event.type,data:JSON.stringify(event.data)});cursor=event.id;}
        if(events.length===0)await stream.writeSSE({event:'heartbeat',data:'{}'});
        await stream.sleep(1000);
      }
    });
  });
  const workPackages=options.workPackages??defaultWorkPackages(service.store);
  app.route('/api/work-packages',workPackageRouter(workPackages,options.workPackageDetails));
  // Ask Sprink: source library and questions, in the same database and behind the same token.
  const sources=options.sources??new SourceStore(service.store.db);
  const uploads=options.uploads??new UploadService(service.store.db,service.dataDir,sources);
  app.route('/api',uploadRouter(uploads));
  app.route('/api',sourceRouter(sources,id=>workPackages.get(id),uploads,options.sourceSearch,service.dataDir));
  if(options.workPackageExports) app.route('/api/work-packages',exportRoutes(options.workPackageExports));
  app.all('/api/*',c=>c.json({error:'APIが見つかりません'},404));
  app.onError((error,c)=>{
    if(error instanceof AppError)return c.json({error:error.message},error.status as ContentfulStatusCode);
    if(error instanceof SyntaxError||error instanceof TypeError)return c.json({error:'入力の形式を確認してください'},400);
    return c.json({error:'処理できませんでした。保存済みの記録は取得し直せます。'},500);
  });
  if(options.webDir&&existsSync(join(options.webDir,'index.html'))) {
    app.use('/*',serveStatic({root:options.webDir}));
    app.get('*',serveStatic({path:join(options.webDir,'index.html')}));
  }else app.get('/',c=>c.text('Sprink API is running. Start the web client with pnpm dev or run pnpm build.'));
  return app;
}
