import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { referenceDrawing, exampleDrawing, validateDrawing, pipeLength, RULE, ADOPTED_RULES, HEAD_FACT_FIELDS, HeadFactsPatchSchema, emptyFacts, validateRules, comparePlan, validateMeasurement as checkMeasurement, MeasurementSchema, checkSchema, type HeadFacts, type Measurement, type Orientation } from '@sprink/core';
import { Store, digest } from './store.js';
import { AppError, type TaskSnapshot, type Observation, type EvidenceRequest, type Artifact } from './models.js';
import { sceneSvg } from './drawing.js';

const fields = HEAD_FACT_FIELDS;
const now=()=>new Date().toISOString();
export function safeId(value: string) {
  if(typeof value!=='string'||!value||value.length>120||!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value)) throw new AppError(400,'IDの形式が不正です');
  return value;
}
function requireText(value: unknown, name: string) {
  if(typeof value!=='string'||!value.trim()||value.length>8000) throw new AppError(400,`${name}が不正です`);
  return value;
}
function patchFacts(input: Partial<HeadFacts>): Partial<HeadFacts> {
  if(!checkSchema(HeadFactsPatchSchema,input)) throw new AppError(400,'factsの形式・値・根拠が不正です');
  for(const [key,fact] of Object.entries(input)) {
    if(typeof fact.value==='string'&&fact.value.length>200||typeof fact.value==='number'&&!Number.isFinite(fact.value)) throw new AppError(400,`${key}の値が不正です`);
  }
  return structuredClone(input);
}

export class FieldService {
  readonly store: Store;
  constructor(readonly dataDir: string) {
    this.store=new Store(dataDir);
    // Code-owned rule updates cannot leave a persisted old pass or artifact looking current.
    this.store.db.transaction(()=>{
      for(const task of this.store.list()) {
        const addedFields=fields.some(field=>task.facts[field]===undefined);
        task.facts={...emptyFacts(),...task.facts};
        const outdated=[task.validation,task.artifact?.validation].some(report=>report&&(
          report.rule.ruleId!==RULE.id||report.rule.versions.ruleVersion!==RULE.version||report.rule.versions.sourceRevision!==RULE.sourceRevision||
          report.rules?.length!==ADOPTED_RULES.length||ADOPTED_RULES.some(definition=>{
            const old=report.rules?.find(result=>result.ruleId===definition.id);
            return !old||old.versions.ruleVersion!==definition.version||old.versions.sourceRevision!==definition.sourceRevision;
          })
        ));
        if(addedFields||outdated)this.changed(task,'adopted_rules_updated');
      }
    })();
  }
  getTask(id:string) {
    const task=this.store.get(safeId(id));
    // Legacy records acquire an editable sample in memory; evidence stays untouched.
    if(!task.plan.drawing)task.plan.drawing=exampleDrawing(task.plan.orientation);
    return task;
  }
  listTasks() { return this.store.listSummaries(); }
  private active(id:string) { const task=this.getTask(id); if(task.state==='cancelled') throw new AppError(409,'この仕事はキャンセル済みです'); return task; }
  private changed(task:TaskSnapshot,type:string) {
    task.revision++; task.updatedAt=now(); task.validation=null; task.artifact=null;
    task.state=task.state==='cancelled'?'cancelled':task.requests.some(r=>r.status==='open')?'waiting':'active';
    task.validation=this.evaluate(task);
    this.store.save(task); this.store.event(task.id,type,{revision:task.revision});
  }
  createTask(input:{id?:string;title?:string;planOrientation?:string;reference?:boolean}={}) {
    const id=safeId(input.id??randomUUID());
    const orientation=input.planOrientation??'pendent';
    if(!['pendent','upright','sideways'].includes(orientation)) throw new AppError(400,'図面方向が不正です');
    return this.store.operation(id,'create',input,()=>{
      const drawing=input.reference?referenceDrawing():exampleDrawing(orientation);
      const target=drawing.heads.find(h=>h.id==='H1')!;
      const plan={revision:1,targetId:'H1',model:target.model,orientation:target.orientation,lengthMeters:pipeLength(drawing,drawing.pipes.find(p=>p.id==='P1')!)/1000,drawing};
      const task:TaskSnapshot={id,title:requireText(input.title??'配管1区間の現場確認','title'),targetId:'H1',revision:1,createdAt:now(),updatedAt:now(),state:'active',plan,facts:emptyFacts(),candidates:[],findings:[],observations:[],measurements:[],requests:[],validation:null,artifact:null};
      this.store.save(task); this.store.event(id,'created',{revision:1}); return task;
    });
  }
  updatePlan(id:string,orientation:string,baseRevision:number,opId:string=randomUUID()) {
    if(!['pendent','upright','sideways'].includes(orientation)) throw new AppError(400,'図面方向が不正です');
    return this.store.operation(id,opId,{orientation,baseRevision},()=>{
      const t=this.active(id); if(t.revision!==baseRevision) throw new AppError(409,'仕事が更新されています');
      const drawing=t.plan.drawing!;
      drawing.heads.find(h=>h.id===t.targetId)!.orientation=orientation as 'pendent'|'upright'|'sideways';
      t.plan={...t.plan,orientation,drawing,revision:t.plan.revision+1};
      t.requests.filter(r=>r.status==='open').forEach(r=>r.status='superseded');
      this.changed(t,'plan_updated'); return t;
    });
  }
  updateDrawing(id:string,input:unknown,baseRevision:number,opId:string=randomUUID()) {
    let drawing: ReturnType<typeof validateDrawing>;
    try {drawing=validateDrawing(input);} catch(error) {throw new AppError(400,error instanceof Error?error.message:'図面が不正です');}
    return this.store.operation(id,opId,{drawing,baseRevision},()=>{
      const t=this.active(id);if(t.revision!==baseRevision)throw new AppError(409,'仕事が更新されています。下書きを書き出してから最新の図面を読み直してください。');
      const head=drawing.heads.find(h=>h.id===t.targetId)!;
      // Current comparison concerns the fixed TY3231 target; other heads are drawing context.
      if(head.model!==t.plan.model)throw new AppError(400,'確認対象H1の型式は変更できません');
      t.plan={...t.plan,drawing,orientation:head.orientation,lengthMeters:pipeLength(drawing,drawing.pipes.find(p=>p.id==='P1')!)/1000,revision:t.plan.revision+1};
      t.requests.filter(r=>r.status==='open').forEach(r=>r.status='superseded');
      this.changed(t,'drawing_updated');return t;
    });
  }
  async addObservation(id:string,metadata:Omit<Observation,'assetId'|'originalAssetId'|'digest'|'width'|'height'>,bytes:Buffer) {
    this.active(id); safeId(metadata.id); requireText(metadata.targetId,'targetId');
    if(!['fixture','ios_camera','ios_ar','file'].includes(metadata.source)||typeof metadata.synthetic!=='boolean'||!Number.isFinite(Date.parse(metadata.capturedAt))) throw new AppError(400,'観測メタデータが不正です');
    if(metadata.source==='fixture'&&!metadata.synthetic) throw new AppError(400,'fixtureは合成記録です');
    if(bytes.length===0||bytes.length>20*1024*1024) throw new AppError(413,'画像は20MB以下にしてください');
    const hash=createHash('sha256').update(bytes).update(digest(metadata)).digest('hex');
    const prior=this.getTask(id).observations.find(o=>o.id===metadata.id);
    if(prior) { if(prior.digest!==hash) throw new AppError(409,'同じ観測IDに異なる内容が送られました'); return prior; }
    let normalized: {data:Buffer;info:{width:number;height:number}};
    try { normalized=await sharp(bytes,{limitInputPixels:40000000}).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).jpeg({quality:90}).toBuffer({resolveWithObject:true}); }
    catch { throw new AppError(400,'画像を読み込めません'); }
    const assetId=`${metadata.id}.jpg`,originalAssetId=`${metadata.id}.original`;
    await mkdir(join(this.dataDir,'assets'),{recursive:true,mode:0o700});
    const write=async(name:string,data:Buffer)=>{ const dest=join(this.dataDir,'assets',name),temp=`${dest}.${randomUUID()}.tmp`; await writeFile(temp,data,{mode:0o600}); await rename(temp,dest); return dest; };
    const originalPath=await write(`${hash}.original`,bytes),normalizedPath=await write(`${hash}.jpg`,normalized.data);
    return this.store.operation(id,`observation:${metadata.id}`,{hash},()=>{
      const t=this.active(id);
      const item:Observation={...metadata,assetId,originalAssetId,digest:hash,width:normalized.info.width,height:normalized.info.height};
      t.observations.push(item);
      const stmt=this.store.db.prepare('INSERT OR IGNORE INTO assets(task_id,id,path,mime) VALUES(?,?,?,?)');
      stmt.run(id,assetId,normalizedPath,'image/jpeg'); stmt.run(id,originalAssetId,originalPath,'application/octet-stream');
      this.changed(t,'observation_added'); return item;
    });
  }
  async asset(id:string,assetId:string) {
    this.getTask(id);
    const row=this.store.db.prepare('SELECT path,mime FROM assets WHERE task_id=? AND id=?').get(id,safeId(assetId)) as {path:string;mime:string}|undefined;
    if(!row) throw new AppError(404,'画像が見つかりません');
    return {bytes:await readFile(row.path),mimeType:row.mime};
  }
  reviewFacts(id:string,input:{baseRevision:number;facts:Partial<HeadFacts>},opId:string=randomUUID(),actor:'manual'|'fixture'='manual') {
    const facts=patchFacts(input.facts);
    return this.store.operation(id,opId,{...input,actor},()=>{
      const t=this.active(id); if(t.revision!==input.baseRevision) throw new AppError(409,'仕事が更新されています。読み直してください');
      for(const [key,fact] of Object.entries(facts)) {
        if(fact.confirmed&&(fact.value===null||fact.evidenceIds.length===0||fact.evidenceIds.some(e=>!t.observations.some(o=>o.id===e&&o.targetId===t.targetId&&!o.superseded)))) throw new AppError(400,'確認する値には同じ対象の有効な根拠が必要です');
        if(actor==='fixture'&&fact.evidenceIds.some(e=>!t.observations.find(o=>o.id===e)?.synthetic)) throw new AppError(400,'実写を合成の確認済みデータにできません');
        (t.facts as unknown as Record<string,unknown>)[key]={...fact,source:actor};
      }
      this.changed(t,'facts_reviewed'); return t;
    });
  }
  requestEvidence(id:string,input:{kind:EvidenceRequest['kind'];reason:string;fields:string[]},opId:string=randomUUID()) {
    requireText(input.reason,'reason');
    if(!['capture','measurement','confirmation'].includes(input.kind)||!Array.isArray(input.fields)||!input.fields.length||!input.fields.every(f=>typeof f==='string'&&f.length<200)) throw new AppError(400,'要求の形式が不正です');
    return this.store.operation(id,opId,input,()=>{
      const t=this.active(id), keys=[...new Set(input.fields)].sort();
      const existing=t.requests.find(r=>r.status==='open'&&r.kind===input.kind&&r.planRevision===t.plan.revision&&r.fields.join('|')===keys.join('|'));
      if(existing) return existing;
      const req:EvidenceRequest={id:randomUUID(),kind:input.kind,reason:input.reason,fields:keys,targetId:t.targetId,status:'open',baseRevision:t.revision,planRevision:t.plan.revision};
      t.requests.push(req);this.changed(t,'evidence_requested');return req;
    });
  }
  answer(id:string,input:{id:string;requestId:string;observationIds:string[];measurementIds?:string[];unavailableReason?:string}) {
    safeId(input.id);
    if(!Array.isArray(input.observationIds)||!Array.isArray(input.measurementIds??[])) throw new AppError(400,'回答の根拠が不正です');
    return this.store.operation(id,`answer:${input.id}`,input,()=>{
      const t=this.active(id),r=t.requests.find(r=>r.id===input.requestId);
      if(!r) throw new AppError(404,'要求が見つかりません');
      if(r.status!=='open'||r.planRevision!==t.plan.revision) throw new AppError(409,'この要求は回答済みか、古い図面版を参照しています');
      if(input.unavailableReason) requireText(input.unavailableReason,'unavailableReason');
      if(input.observationIds.some(e=>!t.observations.some(o=>o.id===e&&o.targetId===r.targetId&&!o.superseded))||(input.measurementIds??[]).some(e=>!t.measurements.some(m=>m.id===e&&m.targetId===r.targetId))) throw new AppError(400,'回答の根拠が存在しないか対象が違います');
      if(!input.unavailableReason&&!input.observationIds.length&&!(input.measurementIds??[]).length) throw new AppError(400,'根拠を追加するか取得できない理由を入力してください');
      if(r.kind==='measurement'&&!input.unavailableReason&&!(input.measurementIds??[]).length) throw new AppError(400,'計測結果が必要です');
      r.status=input.unavailableReason?'unavailable':'answered';r.answer={...input,measurementIds:input.measurementIds??[]};this.changed(t,'evidence_answered');return t;
    });
  }
  addMeasurement(id:string,m:Measurement) {
    if(!checkSchema(MeasurementSchema,m)) throw new AppError(400,'計測の形式が不正です');
    safeId(m.id);
    return this.store.operation(id,`measurement:${m.id}`,m,()=>{
      const t=this.active(id); if(m.targetId!==t.targetId) throw new AppError(400,'計測対象が違います');
      const result=checkMeasurement(m,{targetId:t.targetId,taskRevision:t.revision,observations:t.observations});
      // Failed captures remain evidence of a failed attempt; never turn them into a distance.
      t.measurements.push(m);this.changed(t,'measurement_added');return {measurement:m,validation:result};
    });
  }
  validateMeasurement(id:string,measurementId:string) {
    const t=this.getTask(id),m=t.measurements.find(m=>m.id===measurementId);
    if(!m) throw new AppError(404,'計測が見つかりません');
    return checkMeasurement(m,{targetId:t.targetId,taskRevision:t.revision,observations:t.observations});
  }
  validateTask(id:string) {
    return this.store.db.transaction(()=>{
      const t=this.active(id); t.validation=this.evaluate(t);
      this.store.save(t);this.store.event(id,'validated',t.validation);return t.validation;
    })();
  }
  private evaluate(t:TaskSnapshot) {
    const ctx={targetId:t.targetId,taskRevision:t.revision,observations:t.observations};
    const rules=validateRules(t.facts,ctx),comparison=comparePlan(t.plan.orientation as Orientation,t.facts,ctx);
    return {taskRevision:t.revision,planRevision:t.plan.revision,checkedAt:now(),rule:rules[0],rules,comparison,measurements:t.measurements.map(m=>checkMeasurement(m,ctx)),missingInputs:[...new Set(rules.flatMap(rule=>rule.missingInputs))]};
  }
  prepareArtifact(id:string,opId:string=randomUUID()) {
    const start=this.active(id);
    return this.store.operation(id,opId,{revision:start.revision},()=>{
      const validation=this.validateTask(id),t=this.active(id);
      if(!t.observations.length) throw new AppError(409,'少なくとも1件の観測が必要です');
      if(t.requests.some(r=>r.status==='open')) throw new AppError(409,'追加要求への回答を待っています');
      const unaccounted=validation.missingInputs.filter(key=>!t.requests.some(r=>r.status==='unavailable'&&r.fields.some(f=>key===f||key.startsWith(`${f}.`))));
      if(unaccounted.length) throw new AppError(409,`未確認項目の確認か取得不能の回答が必要です: ${unaccounted.join(', ')}`);
      const artifact:Artifact={
        id:randomUUID(),title:'現場差異・限定ルール確認資料',createdAt:now(),taskRevision:t.revision,planRevision:t.plan.revision,
        synthetic:t.observations.some(o=>o.synthetic),targetId:t.targetId,plan:t.plan,facts:t.facts,
        observations:t.observations,measurements:t.measurements,findings:t.findings,adoptedRules:[...ADOPTED_RULES],validation,
        unresolved:[...validation.missingInputs,
          ...validation.rules.filter(rule=>rule.status==='fail').map(rule=>`${rule.title??rule.ruleId}: 不適合は未解消`),
          ...(validation.comparison.status==='different'?['図面と現物の取付方向に差異あり']:[]),
          ...t.findings.map(f=>f.description),
          ...validation.measurements.map(m=>m.status==='unknown'?`計測 ${m.measurementId}: 取得条件が未確認（${m.missingInputs.join(', ')}）`:`計測 ${m.measurementId}: 物理的な精度は未評価`),
          ...t.requests.filter(r=>r.status==='unavailable').map(r=>r.answer?.unavailableReason??r.reason)],
        scope:`TFP171に基づく採用済み${ADOPTED_RULES.length}条件を個別に判定。設備全体の適合、NFPA配置、散水障害、支持耐震、水理充足、加工寸法、施工可否は判定していません。`,
      };
      t.artifact=artifact;t.state='review_ready';this.store.save(t);this.store.event(id,'artifact_created',{id:artifact.id,revision:t.revision});return artifact;
    });
  }
  cancel(id:string) {
    return this.store.db.transaction(()=>{const t=this.getTask(id);t.state='cancelled';this.store.save(t);this.store.event(id,'cancelled',{});return t;})();
  }
  async replay(id:string,scenario:string,phase:'initial'|'answer'='initial') {
    const options=['normal','nonconforming','matching_wrong','missing','other_model','uninstalled','obstacle','pressure_exceeded'];
    if(!options.includes(scenario)||!['initial','answer'].includes(phase)) throw new AppError(400,'未知のリプレイケースです');
    const orientation=scenario==='nonconforming'||scenario==='matching_wrong'?'upright':'pendent';
    if(scenario==='matching_wrong'&&this.getTask(id).plan.orientation!=='upright') this.updatePlan(id,'upright',this.getTask(id).revision,`plan:${scenario}`);
    const missing=scenario==='missing'&&phase==='initial';
    const observationId=`${scenario}-${phase}`;
    await this.addObservation(id,{id:observationId,targetId:'H1',capturedAt:'2026-09-26T12:00:00.000Z',source:'fixture',synthetic:true},await sharp(Buffer.from(sceneSvg(missing?'unknown':orientation,phase==='answer',scenario==='obstacle'))).png().toBuffer());
    const facts=emptyFacts();
    // These are explicit synthetic installation records, not facts inferred from the rendered scene.
    const values:Record<typeof fields[number],string|number|null>={
      model:scenario==='other_model'?'TY0000':'TY3231',installation:scenario==='uninstalled'?'uninstalled':'installed',
      mounting:'standard',orientation:missing?null:orientation,verticalReference:missing?null:'verified_record',
      escutcheon:null,bulbCondition:'intact',installationWrench:'w_type_6',threadStandard:'npt',installationTorqueFtLb:10,
      construction:null,fieldFinish:'factory_only',leakage:'absent',corrosion:'absent',
      workingPressurePsi:scenario==='pressure_exceeded'?251:100,pressureBasis:'system_maximum',approvalBasis:null,
    };
    for(const key of fields) (facts as unknown as Record<string,unknown>)[key]={value:values[key],confirmed:values[key]!==null,evidenceIds:values[key]===null?[]:[observationId],source:'fixture'};
    if(!this.store.db.prepare('SELECT 1 FROM operations WHERE task_id=? AND id=?').get(id,`facts:${scenario}:${phase}`)) this.reviewFacts(id,{baseRevision:this.getTask(id).revision,facts},`facts:${scenario}:${phase}`,'fixture');
    return this.store.db.transaction(()=>{
      if(phase==='answer') {
        for(const req of this.getTask(id).requests.filter(r=>r.status==='open'&&r.kind!=='measurement')) this.answer(id,{id:`reply-${req.id}`,requestId:req.id,observationIds:[observationId]});
      }
      this.validateTask(id);return this.getTask(id);
    })();
  }
}
