import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {notarize,sha256,readJson,writeJson,chooseIdentity,validateVersions,assertPublishable} from '../scripts/notarize-macos.mjs';

async function fixture(t){
 const dir=await mkdtemp(path.join(tmpdir(),'bridge-notary-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'app.zip'),journal=path.join(dir,'notary.json');await writeFile(file,'signed artifact');
 const hash=await sha256(file),calls=[];
 const replies={submit:{id:'job-1'},info:{status:'In Progress'},wait:{status:'Accepted'},log:{jobId:'job-1',status:'Accepted',sha256:hash,issues:null}};
 const run=async(command,args)=>{
  assert.equal(command,'xcrun');assert.equal(args.at(-1),'json');assert.ok(args.includes('test-profile'));
  const op=args[1];calls.push(op);const reply=replies[op];if(reply instanceof Error)throw reply;return reply;
 };
 return {file,journal,profile:'test-profile',run,replies,calls,hash};
}

test('Apple acceptance is recorded only for the submitted bytes and retrieved log',async t=>{
 const f=await fixture(t);const result=await notarize(f);
 assert.equal(result.phase,'accepted');assert.deepEqual(f.calls,['submit','info','wait','log']);
 assert.equal((await readJson(`${f.journal}.log.json`)).sha256,f.hash);
 await notarize(f);assert.equal(f.calls.filter(op=>op==='submit').length,1);
 await writeFile(f.file,'changed artifact');await assert.rejects(notarize(f),/inputs changed/);
});

test('a timeout resumes the saved submission without uploading again',async t=>{
 const f=await fixture(t);f.replies.wait=new Error('timed out');
 await assert.rejects(notarize(f),/resume; do not resubmit/);
 assert.equal((await readJson(f.journal)).id,'job-1');
 f.replies.info={status:'Accepted'};await notarize(f);
 assert.deepEqual(f.calls,['submit','info','wait','info','log']);
});

test('an interrupted upload with unknown outcome is never silently repeated',async t=>{
 const f=await fixture(t);f.replies.submit=new Error('connection lost');
 await assert.rejects(notarize(f),/connection lost/);
 await assert.rejects(notarize(f),/outcome is unknown/);
 assert.deepEqual(f.calls,['submit']);
});

test('a rejected submission preserves the failure log and never counts as accepted',async t=>{
 const f=await fixture(t);f.replies.info={status:'Invalid'};f.replies.log.status='Invalid';
 await assert.rejects(notarize(f),/Apple rejected/);
 assert.equal((await readJson(f.journal)).phase,'rejected');
 await assert.rejects(notarize(f),/Apple rejected/);
 assert.equal(f.calls.filter(op=>op==='submit').length,1);
});

test('a recovered submission must match the artifact, not just an accepted job ID',async t=>{
 const f=await fixture(t);f.replies.log.sha256='wrong';
 await assert.rejects(notarize(f),/does not match/);
 assert.notEqual((await readJson(f.journal)).phase,'accepted');
 f.replies.log.sha256=f.hash;f.replies.log.status='Invalid';
 await assert.rejects(notarize(f),/Apple rejected/);
 assert.equal((await readJson(f.journal)).phase,'rejected');
});

test('damaged state and a changed credential profile fail closed',async t=>{
 const f=await fixture(t);await writeFile(f.journal,'bad JSON');
 await assert.rejects(notarize(f),SyntaxError);
 await writeJson(f.journal,{sha256:f.hash,profile:'other-profile'});
 await assert.rejects(notarize(f),/inputs changed/);assert.equal(f.calls.length,0);
});

test('identity selection never chooses development or distribution certificates',()=>{
 const developer='Developer ID Application: Example (TEAM)';
 const list=`1) SHA "Apple Distribution: Example (TEAM)"\n2) SHA "${developer}"`;
 assert.equal(chooseIdentity(list),developer);
 assert.throws(()=>chooseIdentity(''),/Set APPLE_SIGNING_IDENTITY/);
 assert.throws(()=>chooseIdentity(`${list}\n3) SHA "Developer ID Application: Other (TEAM)"`),/Set APPLE_SIGNING_IDENTITY/);
 assert.throws(()=>chooseIdentity(list,'Apple Distribution: Example (TEAM)'),/unavailable/);
});

test('release versions must agree across npm, Rust and Tauri',async()=>{
 const root=new URL('../',import.meta.url);
 const json=async file=>JSON.parse(await readFile(new URL(file,root),'utf8'));
 const versions={pkg:await json('package.json'),lock:await json('package-lock.json'),tauri:await json('src-tauri/tauri.conf.json'),cargo:await readFile(new URL('src-tauri/Cargo.toml',root),'utf8'),cargoLock:await readFile(new URL('src-tauri/Cargo.lock',root),'utf8')};
 assert.equal(validateVersions(versions),versions.pkg.version);
 assert.throws(()=>validateVersions({...versions,tauri:{version:'0.0.0'}}),/versions must match/);
});

test('publishing rejects unverified builds, different tags, public releases and unrelated drafts',()=>{
 const valid={tagCommit:'abc',commit:'abc',state:{verified:true,releaseId:12},release:{id:12,isDraft:true}};
 assert.doesNotThrow(()=>assertPublishable(valid));
 for(const change of [{tagCommit:'def'},{state:{verified:false}},{release:{id:12,isDraft:false}},{release:{id:13,isDraft:true}}])assert.throws(()=>assertPublishable({...valid,...change}));
});
