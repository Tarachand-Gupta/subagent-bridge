import crossSpawn from 'cross-spawn';
// npm's Windows launchers need cmd.exe escaping; never concatenate raw arguments.
export function assertLaunchArguments(command,args,platform=process.platform){
 if(platform==='win32'&&[command,...args].some(value=>/[\r\n\0]/.test(String(value))))throw new Error('Windows process arguments cannot contain line breaks or NUL');
}
export function spawn(command,args=[],options={}){
 assertLaunchArguments(command,args);
 return crossSpawn(command,args,{windowsHide:true,...options,shell:false});
}
export function spawnSync(command,args=[],options={}){
 assertLaunchArguments(command,args);
 return crossSpawn.sync(command,args,{windowsHide:true,...options,shell:false});
}
export function execFile(command,args=[],{timeout=15000,maxBuffer=200000,...options}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{...options,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',size=0,done=false;
  const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);error?reject(Object.assign(error,{stdout,stderr})):resolve({stdout,stderr});};
  const timer=setTimeout(()=>{child.kill();finish(new Error('Process timed out'));},timeout);
  const collect=(key,data)=>{size+=Buffer.byteLength(data);if(size>maxBuffer){child.kill();finish(new Error('Process output exceeded limit'));return;}if(key==='stdout')stdout+=data;else stderr+=data;};
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',data=>collect('stdout',data));child.stderr.on('data',data=>collect('stderr',data));child.on('error',finish);child.on('close',code=>finish(code===0?null:Object.assign(new Error(`Process exited ${code}`),{code})));
 });
}
export function shellCommand(args,platform=process.platform){
 const quote=value=>"'"+String(value).replaceAll("'",platform==='win32'?"''":"'\\''")+"'";
 return (platform==='win32'?'& ':'')+args.map(quote).join(' ');
}
export function hookCommand(args,platform=process.platform){
 const command=shellCommand(args,platform);
 return platform==='win32'?'powershell.exe -NoProfile -NonInteractive -EncodedCommand '+Buffer.from(command,'utf16le').toString('base64'):command;
}
