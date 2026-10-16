import {open,readdir} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from '../lib/process.mjs';

// Inspect contents, not file extensions: npm ships native .node/.bare modules
// and extensionless executables under Resources as well as ordinary libraries.
const machMagic=new Set(['feedface','cefaedfe','feedfacf','cffaedfe','cafebabe','bebafeca','cafebabf','bfbafeca']);
export async function signingTargets(app){
 const targets=[];
 async function visit(directory){
  for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   const file=path.join(directory,entry.name);
   if(entry.isSymbolicLink())continue;
   if(entry.isDirectory()){
    await visit(file);
    if(/\.(app|framework|xpc|appex|bundle)$/.test(entry.name))targets.push(file);
   }else if(entry.isFile()){
    const handle=await open(file,'r');
    try{
     const header=Buffer.alloc(8);const {bytesRead}=await handle.read(header,0,8,0);
     const magic=header.subarray(0,4).toString('hex');
     // Java class files share CAFEBABE; a Mach-O fat header has a small,
     // nonzero architecture count in the next word, not a Java version.
     const fat=magic.startsWith('cafe')||magic.startsWith('beba')||magic.startsWith('bfba');
     const count=magic.startsWith('cafe')?header.readUInt32BE(4):header.readUInt32LE(4);
     if(bytesRead===8&&machMagic.has(magic)&&(!fat||(count>0&&count<=16)))targets.push(file);
    }
    finally{await handle.close();}
   }
  }
 }
 await visit(app);
 return [...targets,app];
}

export function requireDeveloperId(identity){
 if(!identity?.startsWith('Developer ID Application: '))throw new Error('APPLE_SIGNING_IDENTITY must be the full Developer ID Application certificate name. Apple Development/Distribution and ad-hoc identities cannot be used for direct distribution.');
 const identities=spawnSync('security',['find-identity','-v','-p','codesigning'],{encoding:'utf8'});
 if(identities.error)throw identities.error;
 if(identities.status!==0||!identities.stdout.includes(`"${identity}"`))throw new Error('The requested Developer ID Application certificate and private key are not available in this Mac’s Keychain.');
}

function run(command,args){
 const result=spawnSync(command,args,{stdio:'inherit'});
 if(result.error)throw result.error;
 if(result.status!==0)throw new Error(`${command} failed (${result.status}); no unsigned fallback will be produced.`);
}

export async function signMacApp(app,identity){
 requireDeveloperId(identity);
 const targets=await signingTargets(app);
 console.log(`Signing ${targets.length} code objects, inside out.`);
 for(const target of targets){
  run('codesign',['--force','--sign',identity,'--timestamp','--options','runtime',target]);
  run('codesign',['--verify','--strict',target]);
 }
 run('codesign',['--verify','--deep','--strict',app]);
}

export function signMacDmg(dmg,identity){
 requireDeveloperId(identity);
 run('codesign',['--force','--sign',identity,'--timestamp',dmg]);
 run('codesign',['--verify','--strict',dmg]);
}
