import * as sqlite from 'node:sqlite';
import {lstat,mkdtemp,chmod,stat,open,link,rm} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
/** Snapshot one SQLite DB; publication is atomic and never replaces an existing path. */
export async function safeSqliteBackup(sourcePath:string,targetPath:string){
 if(typeof sqlite.backup!=='function')throw new Error('SQLITE_BACKUP_REQUIRES_NODE_22_16');
 const source=resolve(sourcePath),target=resolve(targetPath);
 if(!(await lstat(source)).isFile())throw new Error('REGULAR_SOURCE_REQUIRED');
 try{await lstat(target);throw new Error('NEW_TARGET_REQUIRED');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const directory=await mkdtemp(join(dirname(target),'.sqlite-backup-'));const temp=join(directory,'snapshot.sqlite');
 let db:sqlite.DatabaseSync|undefined,verification:sqlite.DatabaseSync|undefined;
 try{
  await chmod(directory,0o700);
  db=new sqlite.DatabaseSync(source,{readOnly:true});db.exec('PRAGMA busy_timeout=5000');
  const pages=await sqlite.backup(db,temp);db.close();db=undefined;
  if(pages<1||(await stat(temp)).size<512)throw new Error('EMPTY_BACKUP');
  await chmod(temp,0o600);verification=new sqlite.DatabaseSync(temp);
  verification.exec('PRAGMA journal_mode=DELETE');
  const checks=verification.prepare('PRAGMA integrity_check').all();
  if(checks.length!==1||Object.values(checks[0]!)[0]!=='ok')throw new Error('BACKUP_INTEGRITY_FAILED');
  verification.close();verification=undefined;
  const file=await open(temp,'r');try{await file.sync();}finally{await file.close();}
  await link(temp,target); // Same filesystem; EEXIST wins even if another writer races our preflight.
  const parent=await open(dirname(target),'r');try{await parent.sync();}finally{await parent.close();}
  return {backupComplete:true,integrity:'ok',pages,overwritten:false};
 }finally{verification?.close();db?.close();await rm(directory,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{if(process.argv.length!==4)throw new Error('SOURCE_AND_NEW_TARGET_REQUIRED');console.log(JSON.stringify(await safeSqliteBackup(process.argv[2]!,process.argv[3]!)));}
 catch{console.error('SQLITE_BACKUP_FAILED: no success claimed; inspect destination before retry; never overwrite an existing backup');process.exitCode=1;}
}
