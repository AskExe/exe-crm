// Source-only: fixed CRM supplier launcher. Not mounted or qualified yet.
import {spawn} from 'node:child_process'
import {performance} from 'node:perf_hooks'
const CHILD='/app/dist/engine/core-modules/company-native-bootstrap/private-native-stock-bootstrap.entry.js'
const REQUEST=12*1024**2+1024,RESULT=24*1024**2,DIAGNOSTIC=1024**2
const TRANSPORT=2*(REQUEST+RESULT+1024)+16384+DIAGNOSTIC+4096
class Refused extends Error{constructor(code){super(code);this.code=code}}
const need=(ok,code)=>{if(!ok)throw new Refused(code)}
function canonical(bytes){const value=JSON.parse(bytes.toString('utf8'));need(Buffer.from(JSON.stringify(value)).equals(bytes),'canonical_frame');return value}
function exact(value,keys){need(value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).sort().join()===keys.slice().sort().join(),'closed_frame')}
function applicationSnapshot(value,actionId){
 exact(value,['actionId','workspaceId','customApplicationId','standardApplicationId'])
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
 need(value.actionId===actionId&&Object.values(value).every(v=>typeof v==='string'&&uuid.test(v))&&value.customApplicationId!==value.standardApplicationId,'application_snapshot')
 return Object.freeze({...value})
}
function sdkRequest(request,applications,sequence){
 exact(request,['version','actionId','workspaceId','applicationId','applicationUniversalIdentifier','schema'])
 need((sequence===1||sequence===2)&&request.version===1&&request.actionId===applications.actionId&&request.workspaceId===applications.workspaceId&&request.applicationId===(sequence===1?applications.standardApplicationId:applications.customApplicationId)&&request.applicationUniversalIdentifier===(sequence===1?'20202020-64aa-4b6f-b003-9c74b97cee20':applications.customApplicationId)&&typeof request.schema==='string'&&Buffer.byteLength(request.schema)>0&&Buffer.byteLength(request.schema)<=2*1024**2&&!request.schema.includes('\0'),'sdk_request')
 return request
}
// A bounded exact reader owns each stream; no host fd is expected in Docker.
class Frames{
 constructor(stream,deadline,quota){this.stream=stream;this.deadline=deadline;this.quota=quota;this.charged=0}
 async bytes(size,eof=false){
  need(size>0&&size<=RESULT+1024,'frame_size');const parts=[];let total=0
  while(total<size){
   need(performance.now()<this.deadline(),'original_end')
   const chunk=this.stream.read(size-total)
   if(chunk!==null){need(Buffer.isBuffer(chunk),'binary_frame');parts.push(chunk);total+=chunk.length;this.charged+=chunk.length;need(this.charged<=this.quota,'transport_quota');continue}
   if(this.stream.readableEnded){if(eof&&total===0)return null;throw new Refused('truncated_frame')}
   await new Promise((resolve,reject)=>{
    const done=error=>{clearTimeout(timer);this.stream.off('readable',ready);this.stream.off('end',ready);this.stream.off('error',failed);error?reject(error):resolve()}
    const ready=()=>done(),failed=()=>done(new Refused('stream_error'))
    const timer=setTimeout(()=>done(new Refused('original_end')),Math.max(1,this.deadline()-performance.now()))
    this.stream.once('readable',ready);this.stream.once('end',ready);this.stream.once('error',failed)
   })
  }
  return Buffer.concat(parts,total)
 }
 async frame(max,eof=false){const head=await this.bytes(4,eof);if(head===null)return null;const size=head.readUInt32BE();need(size>0&&size<=max,'frame_bound');return this.bytes(size)}
}
async function write(stream,bytes,end){
 need(performance.now()<end(),'original_end')
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>finish(new Refused('original_end')),Math.max(1,end()-performance.now()));let finished=false;function finish(error){if(finished)return;finished=true;clearTimeout(timer);error?reject(error):resolve()}stream.write(bytes,error=>finish(error?new Refused('write_error'):null))})
 need(performance.now()<end(),'original_end')
}
async function framed(stream,bytes,end){const header=Buffer.alloc(4);header.writeUInt32BE(bytes.length);await write(stream,header,end);await write(stream,bytes,end)}
export async function run(){
 need(process.platform==='linux'&&process.getuid()===1000&&process.argv.length===2&&process.env.CRM_PRIVATE_STOCK_LAUNCHER_ENABLED==='true','runtime_admission')
 const started=performance.now();let end=started+5000
 const input=new Frames(process.stdin,()=>end,TRANSPORT)
 const raw=await input.frame(16384)
 need(raw.at(-1)===10,'issued_line');const issued=canonical(raw.subarray(0,-1))
 exact(issued,['version','tuple','initial_sql_time','original_lease_expires_at','remaining_work_milliseconds'])
 need(issued.version==='core-first-writer-v1'&&issued.tuple?.product==='crm-workspace'&&Number.isSafeInteger(issued.remaining_work_milliseconds)&&issued.remaining_work_milliseconds>0&&issued.remaining_work_milliseconds<=210000,'issued_frame')
 // Native's existing closed reader independently validates the whole tuple.
 // This limit only bounds transport; actual Core/native SQL fences shrink it.
 end=Math.min(started+181000,started+issued.remaining_work_milliseconds)
 const child=spawn(process.execPath,[CHILD],{cwd:'/app',env:process.env,detached:true,stdio:['pipe','pipe','pipe','pipe','pipe']})
 let status=null,signal=null,closed=false,business=[],stderr=[],stderrBytes=0,businessBytes=0,requests=0,observation=null,primary=null,failed=false,secondaryOverflow=false,stdoutEof=false,stderrEof=false,requestEof=false;const cleanup=[],stdioClosed=[false,false,false,false,false]
 const remember=e=>{if(!failed){failed=true;primary=e}else if(cleanup.length<16)cleanup.push(e);else secondaryOverflow=true}
 const validPid=()=>Number.isSafeInteger(child.pid)&&child.pid>0
 const streamFailure=()=>{remember(new Refused('native_stream_error'));child.stdio?.[3]?.destroy(new Refused('native_stream_error'))}
 let close=Promise.resolve(),requestsIn=null
 try{
  close=new Promise(resolve=>child.once('close',(code,sig)=>{status=code;signal=sig;closed=true;resolve()}))
  child.on('error',()=>remember(new Refused('native_spawn_error')))
  for(const [index,stream]of (child.stdio??[]).entries()){stream?.on('error',streamFailure);stream?.once('close',()=>{stdioClosed[index]=true})}
  process.stdin.on('error',streamFailure);process.stdout.on('error',streamFailure)
  requestsIn=child.stdio?.[3]?new Frames(child.stdio[3],()=>end,2*REQUEST+8+1028):null
  need(validPid()&&child.stdin&&child.stdout&&child.stderr&&child.stdio[3]&&child.stdio[4]&&requestsIn,'native_spawn_streams')
  let retainedDiagnosticBytes=0
  const diagnostic=(chunks,kind,b)=>{
   if(kind==='stdout')businessBytes+=b.length;else stderrBytes+=b.length
   const keep=Math.min(b.length,DIAGNOSTIC-retainedDiagnosticBytes)
   if(keep){chunks.push(Buffer.from(b.subarray(0,keep)));retainedDiagnosticBytes+=keep}
   if(keep!==b.length){remember(new Refused('combined_diagnostic_bound'));child.stdio[3].destroy(new Refused('combined_diagnostic_bound'))}
  }
  child.stdout.once('end',()=>{stdoutEof=true});child.stderr.once('end',()=>{stderrEof=true})
  child.stdout.on('data',b=>diagnostic(business,'stdout',b))
  child.stderr.on('data',b=>diagnostic(stderr,'stderr',b))
  await write(child.stdin,raw,()=>end);child.stdin.end()
  // Metadata creates the standard application before this first FD3 frame.
  // Workspace is source-authenticated native observation here; parent checks
  // its original plan only when that plan actually holds this value.
  const snapshotBytes=await requestsIn.frame(1024)
  const applications=applicationSnapshot(canonical(snapshotBytes),issued.tuple.action_id)
  await framed(process.stdout,Buffer.from(JSON.stringify({kind:'sdk-bind',snapshot:applications})),()=>end)
  const bound=canonical(await input.frame(2048));exact(bound,['kind','snapshot'])
  need(bound.kind==='sdk-bound'&&Buffer.from(JSON.stringify(bound.snapshot)).equals(snapshotBytes),'application_bind_ack')
  await framed(child.stdio[4],snapshotBytes,()=>end)
  for(let sequence=1;sequence<=2;sequence++){
   const requestBytes=await requestsIn.frame(REQUEST),request=canonical(requestBytes)
   sdkRequest(request,applications,sequence)
   // The parent additionally checks the issued stock application snapshot,
   // fixed standard/custom order and current original Core action fence.
   await framed(process.stdout,Buffer.from(JSON.stringify({kind:'sdk-request',sequence,request})),()=>end)
   const response=canonical(await input.frame(RESULT+1024));exact(response,['kind','sequence','result'])
   need(response.kind==='sdk-result'&&response.sequence===sequence,'sdk_sequence')
   const resultBytes=Buffer.from(JSON.stringify(response.result));need(resultBytes.length<=RESULT,'sdk_result_bound')
   await framed(child.stdio[4],resultBytes,()=>end);requests=sequence
  }
  need(await requestsIn.frame(REQUEST,true)===null,'extra_sdk_request');requestEof=true
  let timer;try{await Promise.race([close,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Refused('original_end')),Math.max(1,end-performance.now()))})])}finally{clearTimeout(timer)}
  need(status===0&&signal===null&&!failed&&requests===2&&stdoutEof&&stderrEof&&requestEof&&stdioClosed.every(Boolean),'native_refusal')
  const bytes=Buffer.concat(business),text=bytes.toString('utf8');need(text.endsWith('\n')&&Buffer.from(text).equals(bytes),'native_result')
  observation=canonical(bytes.subarray(0,-1))
 }catch(error){remember(error)}
 finally{
  if(!closed&&!validPid()){let timer;try{await Promise.race([close,new Promise(r=>{timer=setTimeout(r,1000)})])}finally{clearTimeout(timer)}}
  if(!closed&&validPid()){try{process.kill(-child.pid,'SIGTERM')}catch(e){if(e.code!=='ESRCH')remember(new Refused('term_failed'))}
   await Promise.race([close,new Promise(r=>setTimeout(r,1000))])
   if(!closed){try{process.kill(-child.pid,'SIGKILL')}catch(e){if(e.code!=='ESRCH')remember(new Refused('kill_failed'))};await Promise.race([close,new Promise(r=>setTimeout(r,1000))])}
  }
  if(validPid())try{process.kill(-child.pid,0);remember(new Refused('group_present'))}catch(e){if(e.code!=='ESRCH')remember(new Refused('group_absence_unproved'))}
  for(const stream of child.stdio??[])stream?.destroy()
  if(!closed)remember(new Refused('reap_unproved'))
 }
 if(failed){const failure=new Refused('stock_launcher_reconciliation');failure.primary=primary;failure.cleanup=cleanup;failure.secondaryOverflow=secondaryOverflow;failure.stderrPrivate=Buffer.concat(stderr);failure.stdoutPrivate=Buffer.concat(business);failure.closure={closed,status,signal,requests,businessBytes,stderrBytes,stdoutEof,stderrEof,requestEof,stdioClosed:[...stdioClosed]};process.stdin.off('error',streamFailure);process.stdout.off('error',streamFailure);throw failure}
 try{await framed(process.stdout,Buffer.from(JSON.stringify({kind:'final',observation,closure:{closed,status,signal,requests,businessBytes,stderrBytes,stdoutEof,stderrEof,requestEof,stdioClosed:[...stdioClosed]}})),()=>end)}finally{process.stdin.off('error',streamFailure);process.stdout.off('error',streamFailure)}
 return {closed,status,signal,requests,businessBytes,stderrBytes,stdoutEof,stderrEof,requestEof,stdioClosed:[...stdioClosed]}
}
// Supplier packaging will mount a fixed entry calling run(); this proposal is
// deliberately importable for source review and does not execute on import.
