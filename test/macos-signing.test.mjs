import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {signingTargets,requireDeveloperId} from '../scripts/sign-macos.mjs';

test('signing discovers native resources and nested code inside out without following symlinks',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'bridge-sign-'));
 const app=path.join(root,'Bridge.app');
 try{
  const helper=path.join(app,'Contents/Helpers/Helper.app');
  const binary=path.join(helper,'Contents/MacOS/helper');
  const module=path.join(app,'Contents/Resources/node_modules/native/module.node');
  for(const file of [binary,module]){await mkdir(path.dirname(file),{recursive:true});await writeFile(file,Buffer.from('cffaedfe00000000','hex'));}
  await writeFile(path.join(path.dirname(module),'index.js'),'export default {}');
  await writeFile(path.join(path.dirname(module),'Example.class'),Buffer.from('cafebabe00000034','hex'));
  await symlink(root,path.join(app,'outside'));
  const targets=await signingTargets(app);
  assert.deepEqual(new Set(targets),new Set([binary,helper,module,app]));
  assert.ok(targets.indexOf(binary)<targets.indexOf(helper));
  assert.equal(targets.at(-1),app);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('direct distribution rejects ad-hoc and App Store identities before invoking signing tools',()=>{
 for(const identity of [undefined,'-','Apple Development: Example','Apple Distribution: Example'])assert.throws(()=>requireDeveloperId(identity),/Developer ID Application/);
});
