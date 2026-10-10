// Read-only verification of a portable source package, not a signature/trust check.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
try{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'release-manifest.json'),'utf8'));
 if(manifest.format!==1||!Array.isArray(manifest.files)||!manifest.files.length)throw Error('INVALID_MANIFEST');
 const seen=new Set(),changed=[];
 for(const entry of manifest.files){
  if(typeof entry.path!=='string'||!entry.path||entry.path.includes('\\')||entry.path.split('/').some(x=>!x||x==='.'||x==='..')||path.isAbsolute(entry.path)||!/^([a-f0-9]{64})$/.test(entry.sha256)||seen.has(entry.path))throw Error('INVALID_MANIFEST');
  seen.add(entry.path);let location=root;
  for(const part of entry.path.split('/')){location=path.join(location,part);if(!fs.existsSync(location)||fs.lstatSync(location).isSymbolicLink()){changed.push(entry.path);location=undefined;break;}}
  if(location&&(!fs.statSync(location).isFile()||crypto.createHash('sha256').update(fs.readFileSync(location)).digest('hex')!==entry.sha256))changed.push(entry.path);
 }
 console.log(JSON.stringify({packageIntegrity:changed.length===0,filesChecked:seen.size,changed,authenticityVerified:false}));process.exitCode=changed.length?1:0;
}catch{console.error('PACKAGE_MANIFEST_UNAVAILABLE_OR_INVALID');process.exitCode=2;}
