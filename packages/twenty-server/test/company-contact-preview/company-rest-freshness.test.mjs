import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';

// Full shipped service/controller/lease/select classes, with only external
// Nest/TypeORM/provider/ACL boundaries controlled. Not native PG/browser proof.
const sourceRoot=new URL('../../src/',import.meta.url);
const paths=['engine/core-modules/company-auth/company-rest-read.service.ts','engine/core-modules/company-auth/company-auth.policy.ts','engine/core-modules/company-auth/company-auth.config.ts','engine/core-modules/company-mcp/company-read-lease.ts','engine/core-modules/company-mcp/company-mcp.config.ts','engine/api/rest/core/controllers/rest-api-core.controller.ts','engine/twenty-orm/repository/workspace-select-query-builder.ts'];
const sources=new Map(paths.map(path=>{const url=new URL(path,sourceRoot).href;return [url,readFileSync(new URL(url),'utf8')];}));
class HttpException extends Error{constructor(message,status){super(message);this.status=status;}getStatus(){return this.status;}}
class ServiceUnavailableException extends HttpException{constructor(message){super(message,503);}}
class NotFoundException extends HttpException{constructor(message){super(message,404);}}
const contextStore=new AsyncLocalStorage();
class SelectQueryBuilder{
 constructor(builder){Object.assign(this,builder);}
 async getMany(){trace.push('terminal');await gate?.promise;return this.rows.filter(row=>this.allowedOwners.has(row.owner)).map(({secret,...row})=>row);}
}
const dependencies={HttpException,ServiceUnavailableException,NotFoundException,Injectable:()=>value=>value,
 Logger:class{log(){}},RestApiCoreService:class{},CompanyAuthService:class{},AuthenticatedRequest:class{},Response:class{},SelectQueryBuilder,
 withWorkspaceAuthContext:(context,operation)=>contextStore.run(context,operation),buildUserAuthContext:value=>({type:'user',...value}),
 FeatureFlagKey:{IS_ROW_LEVEL_PERMISSION_PREDICATES_ENABLED:'rows'},
 validateQueryIsPermittedOrThrow:value=>{assert.equal(value.shouldBypassPermissionChecks,false);assert.equal(value.objectsPermissions.read,true);trace.push('native-field-acl');},
 applyRowLevelPermissionPredicates:({queryBuilder,authContext})=>{assert.equal(authContext.user.id,uuid('4'));queryBuilder.allowedOwners=new Set([authContext.user.id]);trace.push('native-row-acl');},
 getObjectMetadataFromEntityTarget:()=>({nameSingular:'person'}),formatResult:value=>value,computeTwentyORMException:error=>error,
};
for(const name of ['WorkspaceDeleteQueryBuilder','WorkspaceInsertQueryBuilder','WorkspaceSoftDeleteQueryBuilder','WorkspaceUpdateQueryBuilder'])dependencies[name]=class{};
for(const name of ['PermissionsException','TwentyORMException'])dependencies[name]=Error;
for(const name of ['PermissionsExceptionCode','TwentyORMExceptionCode'])dependencies[name]={};
for(const name of ['Controller','Delete','Get','Patch','Post','Put','Req','Res','UseFilters','UseGuards','RestApiExceptionFilter','CustomPermissionGuard','JwtAuthGuard','WorkspaceAuthGuard'])dependencies[name]=()=>{};
globalThis.companyRestControlledDependencies=dependencies;
const dependencySource=Object.keys(dependencies).map(name=>`export const ${name}=globalThis.companyRestControlledDependencies.${name};`).join('\n');
const hooks=registerHooks({
 resolve(specifier,context,next){
  if(sources.has(specifier))return{url:specifier,shortCircuit:true};
  if(sources.has(context.parentURL)){
   if(specifier.startsWith('node:'))return next(specifier,context);
   const own=specifier.startsWith('src/')?new URL(specifier.slice(4)+'.ts',sourceRoot).href:new URL(specifier+'.ts',context.parentURL).href;
   if(sources.has(own))return{url:own,shortCircuit:true};
   return{url:'fixture:dependencies',shortCircuit:true};
  }
  return next(specifier,context);
 },
 load(url,context,next){
  if(sources.has(url)){
   // Remove Nest declaration plumbing only; execute complete unchanged methods.
   const source=sources.get(url).replace(/^\s*@(Injectable|Controller|UseGuards|UseFilters|Get|Post|Put|Patch|Delete)\([^\n]*\)\s*$/gm,'').replace(/@(Req|Res)\(\)\s*/g,'');
   return{format:'module',source:stripTypeScriptTypes(source,{mode:'transform'}),shortCircuit:true};
  }
  if(url==='fixture:dependencies')return{format:'module',source:dependencySource,shortCircuit:true};
  return next(url,context);
 },
});
const {CompanyRestReadService}=await import(new URL(paths[0],sourceRoot));
const {RestApiCoreController}=await import(new URL(paths[5],sourceRoot));
const {WorkspaceSelectQueryBuilder}=await import(new URL(paths[6],sourceRoot));
const {withCompanyReadLease,withCompanyRestReadControl,assertCompanyReadShape}=await import(new URL(paths[3],sourceRoot));
const {companySubject,companyCredential}=await import(new URL(paths[1],sourceRoot));
const uuid=value=>'00000000-0000-4000-8000-'+value.padStart(12,'0');
const configuration={origin:'https://crm.a.test',companyId:uuid('1'),workspaceId:uuid('2'),bindingId:uuid('3'),generationId:uuid('8'),audience:'crm_a'};
const userContext={workspace:{id:configuration.workspaceId},user:{id:uuid('4')},userWorkspaceId:uuid('5'),workspaceMemberId:uuid('6'),workspaceMember:{id:uuid('6')}};
const envelope={version:1,subject_id:uuid('7'),company_id:configuration.companyId,product:'crm',resource_kind:'crm-workspace',binding_id:configuration.bindingId,native_id:configuration.workspaceId,generation_id:configuration.generationId,authz_epoch:'1',audience:configuration.audience,scopes:['crm:read'],current_role:'member',technical_status:'accepted',subscription_entitled:true};
const key='Bearer exk_'+ 'a'.repeat(43);
let trace=[],gate,flag=true,authorityDenied=false,fingerprint='current',businessCalls=0,currentCalls=0;
const auth={configuration,currentRead:async(request,signal)=>{
 assert.equal(trace.includes('begin')&&!trace.includes('release'),false,'Provider must be outside transaction');
 signal.throwIfAborted();currentCalls++;trace.push('authority');companyCredential(request);
 companySubject(request.headers.authorization===key?envelope:{...envelope,company_id:uuid('99')},configuration);
 if(authorityDenied)throw new HttpException('Current authority denied',401);
 return{context:userContext,fingerprint};
}};
let runner;
const reads={get:async request=>{
 businessCalls++;assert.equal(request.workspace.id,configuration.workspaceId);assert.equal(contextStore.getStore().user.id,userContext.user.id);
 assert.deepEqual(request.query,{depth:'0',limit:'2'});assert.equal(request.headers['x-workspace-id'],undefined);
 return withCompanyReadLease({createQueryRunner:mode=>{
  assert.equal(mode,'master');runner={isTransactionActive:false,connect:async()=>trace.push('connect'),startTransaction:async()=>{trace.push('begin');runner.isTransactionActive=true;},query:async()=>trace.push('query'),rollbackTransaction:async()=>{trace.push('rollback');runner.isTransactionActive=false;},release:async()=>trace.push('release')};return runner;
 }},async lease=>{
  assert.ok(lease);const builder=new WorkspaceSelectQueryBuilder({expressionMap:{mainAlias:{target:'person'}},rows:[{id:uuid('10'),owner:userContext.user.id,name:'A',secret:'hidden'},{id:uuid('11'),owner:uuid('90'),name:'B',secret:'hidden'}]}, {read:true}, {},false,contextStore.getStore(),{rows:flag});
  return {data:{people:await lease.terminal(()=>builder.getMany())}};
 });
}};
const reset=()=>{trace=[];gate=undefined;flag=true;authorityDenied=false;fingerprint='current';businessCalls=0;currentCalls=0;process.env.CRM_COMPANY_MODE='true';process.env.CRM_COMPANY_MCP_ENABLED='false';};
const request=()=>Object.assign(new EventEmitter(),{headers:{host:'crm.a.test',authorization:key},rawHeaders:['Host','crm.a.test','Authorization',key],method:'GET',path:'/rest/people',originalUrl:'/rest/people?depth=0&limit=2'});
const response=()=>Object.assign(new EventEmitter(),{writableEnded:false,statusCode:undefined,body:undefined,setHeader(){},type(){return this;},status(code){this.statusCode=code;return this;},send(body){this.body=body;this.writableEnded=true;return this;}});
const call=async(req=request(),res=response())=>{const service=new CompanyRestReadService(auth,reads);await new RestApiCoreController(reads,service).handleApiGet(req,res);return res;};
const waitForRead=async()=>{while(!trace.includes('terminal'))await new Promise(resolve=>setTimeout(resolve,1));};
const ownDeadline=setTimeout(()=>process.exit(1),15000);

test('validA directREST uses owned lease and native field/row filters; provider recheck follows release',async()=>{
 reset();const res=await call();assert.equal(res.statusCode,200);assert.deepEqual(JSON.parse(res.body).data.people,[{id:uuid('10'),owner:userContext.user.id,name:'A'}]);assert.equal(currentCalls,2);assert.ok(trace.lastIndexOf('authority')>trace.indexOf('release'));assert.ok(trace.includes('native-row-acl'));assert.ok(trace.includes('native-field-acl'));
});
for(const reason of ['central-revoke','native-role-change','abort'])test('suspendedA read denies late body after '+reason,async()=>{
 reset();let resume;gate={promise:new Promise(resolve=>{resume=resolve;})};const req=request(),res=response();const pending=call(req,res);await waitForRead();
 if(reason==='central-revoke')authorityDenied=true;else if(reason==='native-role-change')fingerprint='downgraded';else req.emit('aborted');
 resume();await assert.rejects(pending);assert.equal(res.body,undefined);assert.deepEqual(trace.filter(stage=>['rollback','release'].includes(stage)),['rollback','release']);
});
test('B credential on A rejected before business; no workspace selection',async()=>{
 reset();const req=request(),res=response();req.headers.authorization='Bearer exk_'+'b'.repeat(43);req.rawHeaders[3]=req.headers.authorization;await assert.rejects(call(req,res));assert.equal(businessCalls,0);assert.equal(res.body,undefined);
});
for(const token of ['Bearer native-key','Bearer a.b.c','Bearer admin-secret'])test('direct legacy credential denied: '+token,async()=>{
 reset();const req=request();req.headers.authorization=token;req.rawHeaders[3]=token;await assert.rejects(call(req));assert.equal(businessCalls,0);assert.equal(currentCalls,0);
});
test('native cookie alone and ambiguous own credentials deny before business',async()=>{
 for(const cookie of ['exe_sess=native','__Host-exe_crm_session=exs_'+'a'.repeat(43)]){
  reset();const req=request();req.headers.cookie=cookie;if(cookie.startsWith('exe_sess'))delete req.headers.authorization;
  await assert.rejects(call(req));assert.equal(businessCalls,0);
 }
});
test('rowflag disabled denies controlled reads before terminal SQL, ordinary native path unchanged',async()=>{
 reset();flag=false;await assert.rejects(call(),error=>error.getStatus()===503);assert.equal(trace.includes('terminal'),false);assert.ok(trace.includes('release'));
 const ordinary=new WorkspaceSelectQueryBuilder({expressionMap:{mainAlias:{target:'person'}},rows:[],allowedOwners:new Set()}, {read:true},{},false,userContext,{rows:false});await ordinary.getMany();
});
test('offmode ordinary controller preserves existing service dispatch',async()=>{
 reset();process.env.CRM_COMPANY_MODE='false';let calls=0;const legacy={get:async()=>{calls++;return{ordinary:true};}};const res=response();await new RestApiCoreController(legacy,{handle:async()=>assert.fail('Hosted dispatch')}).handleApiGet(request(),res);assert.deepEqual(res.body,{ordinary:true});assert.equal(calls,1);
});
test('owned controls snapshot clocks/read and refuse extensions/accessors',async()=>{
 reset();const control={signal:new AbortController().signal,read:{object:'people',limit:2},monotonicDeadline:performance.now()+20,absoluteDeadline:Date.now()+20};
 await assert.rejects(withCompanyRestReadControl(control,async()=>{control.read.object='companies';control.monotonicDeadline+=9000;control.absoluteDeadline+=9000;await new Promise(resolve=>setTimeout(resolve,30));return withCompanyReadLease({createQueryRunner:()=>assert.fail('Expired allocation')},async()=>{});}));
 for(const clock of ['monotonicDeadline','absoluteDeadline']){const value={signal:new AbortController().signal,read:{object:'people',limit:2},monotonicDeadline:performance.now()+1000,absoluteDeadline:Date.now()+1000};value[clock]+=10000;assert.throws(()=>withCompanyRestReadControl(value,async()=>{}));}
});
test('captured read and original signal survive caller mutation; accessors never execute',async()=>{
 reset();const original=new AbortController();const control={signal:original.signal,read:{object:'people',limit:2},monotonicDeadline:performance.now()+1000,absoluteDeadline:Date.now()+1000};
 await withCompanyRestReadControl(control,async()=>{
  control.read.object='companies';control.signal=new AbortController().signal;
  assertCompanyReadShape('many','people',{first:2,selectedFieldsResult:{relations:{},aggregate:{}}});
  original.abort();await assert.rejects(withCompanyReadLease({createQueryRunner:()=>assert.fail('Aborted allocation')},async()=>{}));
 });
 let invoked=0;const invalid={...control};Object.defineProperty(invalid,'read',{get(){invoked++;return control.read;}});
 assert.throws(()=>withCompanyRestReadControl(invalid,async()=>{}));assert.equal(invoked,0);
});
test('provider denial/outage preserves401/503 and never writes positive response',async()=>{
 for(const status of [401,503]){reset();const res=response();const service=new CompanyRestReadService({...auth,currentRead:async()=>{throw new HttpException('Controlled unavailable',status);}},reads);await assert.rejects(service.handle(request(),res,new AbortController().signal),error=>error.getStatus()===status);assert.equal(res.body,undefined);assert.equal(businessCalls,0);}
});
test('result bound denies serialization and percredential rate remains finite',async()=>{
 reset();const res=response();const oversized=new CompanyRestReadService(auth,{get:async()=>({data:'x'.repeat(262144)})});await assert.rejects(oversized.handle(request(),res,new AbortController().signal),error=>error.getStatus()===503);assert.equal(res.body,undefined);
 reset();const limited=new CompanyRestReadService(auth,reads);for(let index=0;index<30;index++)await limited.handle(request(),response(),new AbortController().signal);
 const denied=response();await assert.rejects(limited.handle(request(),denied,new AbortController().signal),error=>error.getStatus()===429);assert.equal(denied.body,undefined);assert.equal(businessCalls,30);
});
for(const change of ['wrong-host','wrong-origin','selector','duplicate-auth'])test('finite ingress denies '+change,async()=>{
 reset();const req=request();if(change==='wrong-host')req.headers.host='crm.b.test';if(change==='wrong-origin')req.headers.origin='https://crm.b.test';if(change==='selector')req.originalUrl+='&workspaceId='+uuid('99');if(change==='duplicate-auth')req.rawHeaders.push('Authorization',key);await assert.rejects(call(req));assert.equal(businessCalls,0);
});
after(()=>{clearTimeout(ownDeadline);hooks.deregister();delete globalThis.companyRestControlledDependencies;assert.ok(process.memoryUsage().rss<512*1024*1024);});
