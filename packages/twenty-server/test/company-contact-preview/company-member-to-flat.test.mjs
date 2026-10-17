// Controlled raw-PG shape tests; no PG, CompanyAuthService, native validators,
// ACL or authority is executed. Preview's processor remains a trusted test stub.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){
 if(context.parentURL?.endsWith('/company-member-to-flat.ts') && specifier==='../company-contact-preview/contact-preview-snapshot')return next(new URL(specifier+'.ts',context.parentURL).href,context);
 if(context.parentURL?.endsWith('/contact-metadata-preview.ts') && ['./contact-csv-preview','./contact-preview-snapshot'].includes(specifier))return next(new URL(specifier+'.ts',context.parentURL).href,context);
 return next(specifier,context);
}});
const {companyMemberToFlat:convert}=await import('../../src/engine/core-modules/company-auth/company-member-to-flat.ts');
const {previewContactCsvWithMetadata:preview}=await import('../../src/engine/core-modules/company-contact-preview/contact-metadata-preview.ts');
const memberId='10000000-0000-4000-8000-000000000001',userId='20000000-0000-4000-8000-000000000002';
const binding=()=>({workspace_member_id:memberId,user_id:userId});
const raw=()=>({id:memberId,userId,createdAt:new Date('2026-10-02T01:02:03.004Z'),updatedAt:new Date('2026-10-02T02:03:04.005Z'),deletedAt:null,position:0,nameFirstName:'Ada',nameLastName:'李',colorScheme:'System',locale:'en',avatarUrl:null,userEmail:'ada@example.test',calendarStartDay:7,timeZone:'system',dateFormat:'SYSTEM',timeFormat:'SYSTEM',numberFormat:'SYSTEM',searchVector:null,createdBySource:'MANUAL',createdByName:'System',createdByWorkspaceMemberId:null,updatedBySource:'MANUAL',updatedByName:'System',updatedByWorkspaceMemberId:null});
const context=member=>({authContext:{type:'user',workspace:{id:'workspace-a'},user:{id:userId},userWorkspaceId:'uw-a',workspaceMemberId:memberId,workspaceMember:member},flatObjectMetadata:{id:'person-a',universalIdentifier:'person-a',applicationId:'app-a',workspaceId:'workspace-a',nameSingular:'person',fieldIds:['t']},flatFieldMetadataMaps:{universalIdentifierById:{t:'t'},byUniversalIdentifier:{t:{id:'t',universalIdentifier:'t',applicationId:'app-a',name:'title',type:'TEXT',workspaceId:'workspace-a',objectMetadataId:'person-a',isActive:true,isSystem:false,isUIReadOnly:false,isNullable:true}}},flatObjectMetadataMaps:{byUniversalIdentifier:{}}});
const bytes=new TextEncoder().encode('Title\nPerson'),mapping=[{columnIndex:0,fieldId:'t',encoding:'text'}];
const refused=error=>error.name==='CompanyMemberContextError' && error.message==='Company member context unavailable';

test('complete raw row scalar data survives declared Date normalization and reconstructed native name',async()=>{
 const row=raw(),member=convert(row,binding());
 for(const key of Object.keys(row).filter(k=>!['createdAt','updatedAt'].includes(k)))assert.deepEqual(member[key],row[key]);
 assert.equal(member.createdAt,'2026-10-02T01:02:03.004Z');assert.equal(member.updatedAt,'2026-10-02T02:03:04.005Z');assert.deepEqual(member.name,{firstName:'Ada',lastName:'李'});assert.equal(member.deletedAt,null);assert.ok(Object.isFrozen(member)&&Object.isFrozen(member.name));
 row.createdAt.setUTCFullYear(2030);assert.equal(member.createdAt,'2026-10-02T01:02:03.004Z');
 const result=await preview(bytes,mapping,context(member),{async process(args){assert.deepEqual(args.authContext.workspaceMember,member);return args.partialRecordInputs}});assert.deepEqual(result.rows[0].candidate,{title:'Person'});assert.equal(result.writeAdmission,false);
});

test('declared nullable fields and valid timestamp edges preserve values without inventing defaults',()=>{
 for(const value of [null,new Date('2026-10-01T00:00:00.000Z')]){const row=raw();row.deletedAt=value;row.nameFirstName=null;row.nameLastName='';assert.equal(convert(row,binding()).deletedAt,value===null?null:'2026-10-01T00:00:00.000Z');assert.deepEqual(convert(row,binding()).name,{firstName:null,lastName:''})}
 for(const milliseconds of [-8640000000000000,8640000000000000]){const row=raw();row.createdAt=new Date(milliseconds);assert.equal(convert(row,binding()).createdAt,Date.prototype.toISOString.call(row.createdAt))}
 for(const key of ['createdAt','updatedAt','deletedAt','position','nameFirstName','nameLastName','colorScheme','locale','avatarUrl','userEmail','calendarStartDay','timeZone','dateFormat','timeFormat','numberFormat','searchVector']){const row=raw();delete row[key];assert.throws(()=>convert(row,binding()),refused)}
});

test('binding mismatch, missing scalar fields and unexpected Date/class data refuse complete context',()=>{
 for(const mutate of [r=>r.id=userId,r=>r.userId=memberId,r=>r.position='0',r=>r.calendarStartDay=1.5,r=>r.colorScheme=null,r=>r.extra=new Date(),r=>r.extra=new (class Opaque{})(),r=>r.name={firstName:'ambiguous'},r=>r.extra='X'.repeat(16385),r=>r.extra=Array.from({length:32},()=> 'X'.repeat(3000))]){const row=raw();mutate(row);assert.throws(()=>convert(row,binding()),refused)}
 assert.throws(()=>convert(raw(),{...binding(),user_id:'other'}),refused);
});

test('invalid, overridden, subclass and accessor dates never invoke hooks or getters',()=>{
 let reads=0;class SubDate extends Date{};
 const hooked=new Date();Object.defineProperty(hooked,'toJSON',{get(){reads++;return()=>''}});
 const methodOverride=new Date();methodOverride.toISOString=()=>{reads++;return 'forged'};
 const impostor=Object.create(Date.prototype);
 for(const bad of [new Date(NaN),new Date(8640000000000001),new SubDate(),hooked,methodOverride,impostor,'2026-10-02T01:02:03.004Z',null]){const row=raw();row.createdAt=bad;assert.throws(()=>convert(row,binding()),refused)}
 for(const key of ['createdAt','nameFirstName','id']){const row=raw();Object.defineProperty(row,key,{enumerable:true,get(){reads++;return 'forged'}});assert.throws(()=>convert(row,binding()),refused)}
 const fixed=binding();Object.defineProperty(fixed,'user_id',{enumerable:true,get(){reads++;return userId}});assert.throws(()=>convert(raw(),fixed),refused);assert.equal(reads,0);
});

test('flattened member dependencies still bind preview and identity/timestamp replacement during await refuses',async()=>{
 for(const mutate of [c=>c.authContext.workspaceMember={...c.authContext.workspaceMember,updatedAt:'2026-10-03T00:00:00.000Z'},c=>c.authContext.workspaceMember={...c.authContext.workspaceMember,userId:memberId},c=>c.authContext.workspaceMember={...c.authContext.workspaceMember,id:userId}]){
  const fixed=context(convert(raw(),binding()));let release,enter;const wait=new Promise(r=>release=r),entered=new Promise(r=>enter=r);
  const pending=preview(bytes,mapping,fixed,{async process(args){enter();await wait;return args.partialRecordInputs}});await entered;mutate(fixed);release();await assert.rejects(pending,error=>error.name==='ContactPreviewInvariantError');
 }
});

test('shipped CompanyAuth boundary converts only after raw bound identity lookup and before return',()=>{
 const source=fs.readFileSync(new URL('../../src/engine/core-modules/company-auth/company-auth.service.ts',import.meta.url),'utf8');
 const lookup=source.indexOf('.getRawOne<unknown>()'),convertAt=source.indexOf('const flatMember = companyMemberToFlat(member, binding);'),roleCheck=source.indexOf('current.userWorkspaceRoleMap[binding.user_workspace_id]'),returned=source.indexOf('workspaceMember: flatMember');
 assert.ok(lookup>=0&&convertAt>lookup&&roleCheck>convertAt&&returned>roleCheck);assert.ok(source.includes('workspaceMemberId: flatMember.id'));assert.equal(source.includes('...member,'),false);
});
