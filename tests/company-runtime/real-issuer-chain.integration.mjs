// Fixed disposable operator. Genuine target introspection is the sole subject authority.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {request} from 'node:http';
const require=createRequire('/app/packages/twenty-server/package.json');
const {Client}=require('pg');
const {companySubject}=require('/app/packages/twenty-server/dist/engine/core-modules/company-auth/company-auth.policy.js');
const c=JSON.parse(readFileSync(0,'utf8'));
assert.equal(c.operation,'provision');assert.equal(c.workspace_id,c.profile.native_id);
for(const key of ['workspace_id'])assert.match(c[key],/^[a-f0-9-]{36}$/);
assert.match(c.secret,/^[A-Za-z0-9_-]{43}$/);
const current=token=>new Promise((resolve,reject)=>{
 assert.match(token,/^exs_[A-Za-z0-9_-]{43}$/);let bytes=0;const chunks=[];
 const q=request('http://core-native:8097/internal/session-broker/introspect',{method:'POST',timeout:3000,headers:{Authorization:'Basic '+Buffer.from(c.profile.client_id+':'+c.secret).toString('base64'),'Content-Type':'application/json'}},r=>{
  try{assert.equal(r.statusCode,200);assert.equal(r.headers['content-type'],'application/json');assert.equal(r.headers['content-encoding'],undefined)}catch(error){r.resume();reject(error);return}
  r.on('data',b=>{bytes+=b.length;if(bytes>16384)q.destroy(Error('Introspection body bound'));else chunks.push(b)});r.on('error',reject);r.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks)))}catch(e){reject(e)}});
 });q.on('error',reject);q.on('timeout',()=>q.destroy(Error('Introspection deadline')));q.end(JSON.stringify({session_token:token}));
});
const db=new Client({connectionString:c.database,statement_timeout:2000,query_timeout:3000});
let first,connected=false;const bindings=[],roles={};
try{
 const identities=[];
 for(const [role,input]of Object.entries(c.bootstrap)){
  assert.ok(['owner','member'].includes(role));const envelope=await current(input.token);
  const subject=companySubject(envelope,{companyId:c.profile.company_id,workspaceId:c.workspace_id,bindingId:c.profile.binding_id,generationId:c.profile.generation_id,audience:c.profile.audience});
  assert.equal(subject,input.subject);assert.equal(envelope.current_role,role);assert.ok(!identities.some(x=>x.subject===subject));identities.push({role,subject});
 }
 assert.equal(identities.length,c.profile.label==='issuer-a'?2:1);
 await db.connect();connected=true;const nativeRole=(await db.query('SELECT current_user,r.rolsuper,r.rolbypassrls FROM pg_roles r WHERE rolname=current_user')).rows[0];assert.equal(nativeRole.rolsuper,false);assert.equal(nativeRole.rolbypassrls,false);
 const workspace=(await db.query('SELECT id,"databaseSchema","activationStatus","suspendedAt" FROM core.workspace WHERE id=$1 AND "deletedAt" IS NULL',[c.workspace_id])).rows;assert.equal(workspace.length,1);assert.equal(workspace[0].activationStatus,'ACTIVE');assert.equal(workspace[0].suspendedAt,null);const schema=workspace[0].databaseSchema;assert.match(schema,/^[a-z_][a-z0-9_]{0,62}$/);
 const objects=(await db.query('SELECT id,"applicationId", "nameSingular" FROM core."objectMetadata" WHERE "workspaceId"=$1 AND "nameSingular" IN (\'person\',\'company\')',[c.workspace_id])).rows;assert.equal(objects.length,2);assert.equal(objects[0].applicationId,objects[1].applicationId);const app=objects[0].applicationId;
 await db.query('BEGIN');
 for(const {role,subject}of identities){
  // New returned UUIDs only; no email lookup/adoption of bootstrap admins or defaults.
  const user=(await db.query('INSERT INTO core."user"(email,"firstName","lastName","isEmailVerified",disabled,"passwordHash","canImpersonate","canAccessFullAdminPanel") VALUES($1,$2,$3,true,false,NULL,false,false) RETURNING id',[randomUUID()+'@native.invalid',role,'Fixture'])).rows[0];
  const uw=(await db.query('INSERT INTO core."userWorkspace"("workspaceId","userId") VALUES($1,$2) RETURNING id',[c.workspace_id,user.id])).rows[0];
  const member=(await db.query(`INSERT INTO "${schema}"."workspaceMember"("nameFirstName","nameLastName","userId","userEmail","colorScheme",locale,"avatarUrl") SELECT $1,$2,id,email,'System','en','' FROM core."user" WHERE id=$3 RETURNING id`,[role,'Fixture',user.id])).rows[0];assert.ok(member);
  const nativeReadRole=(await db.query('INSERT INTO core.role("universalIdentifier","applicationId","workspaceId",label,"canReadAllObjectRecords","canUpdateAllObjectRecords","canSoftDeleteAllObjectRecords","canDestroyAllObjectRecords","canUpdateAllSettings","canAccessAllTools","isEditable","canBeAssignedToUsers","canBeAssignedToAgents","canBeAssignedToApiKeys") VALUES($1,$2,$3,$4,false,false,false,false,false,false,false,true,false,false) RETURNING id',[randomUUID(),app,c.workspace_id,'Fixture read '+randomUUID()])).rows[0];
  for(const object of objects)await db.query('INSERT INTO core."objectPermission"("universalIdentifier","applicationId","workspaceId","roleId","objectMetadataId","canReadObjectRecords","canUpdateObjectRecords","canSoftDeleteObjectRecords","canDestroyObjectRecords") VALUES($1,$2,$3,$4,$5,true,false,false,false)',[randomUUID(),app,c.workspace_id,nativeReadRole.id,object.id]);
  await db.query('INSERT INTO core."roleTarget"("universalIdentifier","applicationId","workspaceId","roleId","userWorkspaceId") VALUES($1,$2,$3,$4,$5)',[randomUUID(),app,c.workspace_id,nativeReadRole.id,uw.id]);
  if(role==='member'){
   const person=objects.find(x=>x.nameSingular==='person');const field=(await db.query('SELECT id,type FROM core."fieldMetadata" WHERE "workspaceId"=$1 AND "objectMetadataId"=$2 AND name=\'jobTitle\'',[c.workspace_id,person.id])).rows;assert.equal(field.length,1);assert.equal(field[0].type,'TEXT');
   await db.query('INSERT INTO core."rowLevelPermissionPredicate"("universalIdentifier","applicationId","workspaceId","roleId","objectMetadataId","fieldMetadataId",operand,value) VALUES($1,$2,$3,$4,$5,$6,\'CONTAINS\',$7::jsonb)',[randomUUID(),app,c.workspace_id,nativeReadRole.id,person.id,field[0].id,JSON.stringify('Synthetic Updated')]);
  }
  bindings.push({subject_id:subject,user_id:user.id,user_workspace_id:uw.id,workspace_member_id:member.id});roles[subject]=nativeReadRole.id;
 }
 const verified=(await db.query('SELECT count(*)::int AS n FROM core."user" WHERE id=ANY($1::uuid[]) AND "passwordHash" IS NULL AND NOT "canImpersonate" AND NOT "canAccessFullAdminPanel"',[bindings.map(x=>x.user_id)])).rows[0];assert.equal(verified.n,bindings.length);
 await db.query('COMMIT');console.log(JSON.stringify({workspace_id:c.workspace_id,schema,application_id:app,bindings,roles,native_role:nativeRole}));
}catch(e){first=e;try{if(connected)await db.query('ROLLBACK')}catch(close){e.cleanup=[{stage:'rollback',class:close.constructor.name}]};throw e}
finally{try{await db.end()}catch(close){if(first){first.cleanup??=[];first.cleanup.push({stage:'db-close',class:close.constructor.name})}else throw close}}
