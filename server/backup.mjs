import {DatabaseSync,backup} from 'node:sqlite';
import {mkdir,chmod,writeFile,readFile,rename,unlink,readdir,stat,copyFile,mkdtemp,rm,realpath} from 'node:fs/promises';
import {createReadStream,constants} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,join,basename,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
const pattern=/^salon-backup-\d{8}T\d{9}Z-[a-f0-9-]+\.sqlite$/;
const required=['businesses','users','records','operations','audit','subscriptions','provider_admins'];
export async function digest(file){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex')}
export function inspect(file){const db=new DatabaseSync(file,{readOnly:true});try{const check=db.prepare('PRAGMA integrity_check').all();if(check.length!==1||Object.values(check[0])[0]!=='ok')throw Error('Database integrity check failed');if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Database foreign key check failed');const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name);for(const table of required)if(!tables.includes(table))throw Error('Not a complete salon database: missing '+table);const counts={};for(const table of tables.filter(x=>!x.startsWith('sqlite_'))){counts[table]=db.prepare('SELECT count(*) n FROM "'+table.replaceAll('"','""')+'"').get().n}return counts}finally{db.close()}}
export async function verifyBackup(file){const manifest=JSON.parse(await readFile(file+'.json','utf8'));if(manifest.format!==1||manifest.file!==basename(file)||await digest(file)!==manifest.sha256)throw Error('Backup checksum or manifest mismatch');const counts=inspect(file);if(JSON.stringify(counts)!==JSON.stringify(manifest.counts))throw Error('Backup table counts mismatch');return manifest}
export async function restoreCopy(file,destination){await verifyBackup(file);await copyFile(file,destination,constants.COPYFILE_EXCL);try{await chmod(destination,0o600);const counts=inspect(destination);if(await digest(destination)!==await digest(file))throw Error('Restored copy checksum mismatch');return counts}catch(e){await unlink(destination);throw e}}
async function jsonAtomic(path,value){const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temp,path)}
export async function runBackup({file,dir,keep=168,remote='',rclone='rclone'}={}){
 if(!file||!dir)throw Error('DATABASE_FILE and BACKUP_DIR must be configured');if(!Number.isInteger(keep)||keep<2||keep>10000)throw Error('BACKUP_KEEP must be 2–10000');
 file=await realpath(file);dir=resolve(dir);await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);
 // Never create a blank source database or store backups beside publicly served files.
 const sourceStat=await stat(file);if(!sourceStat.isFile())throw Error('Source is not a database file');
 if(/(?:^|[/\\])(public_html|web)(?:[/\\]|$)/.test(dir))throw Error('Backups must be outside web/public_html');
 const lock=join(dir,'.backup-lock');try{await mkdir(lock,{mode:0o700})}catch(e){if(e.code==='EEXIST')throw Error('Backup lock exists. Another backup may be running; inspect before removing the lock.');throw e}
 let tmp,snapshotPath;const statusPath=join(dir,'status.json'),started=new Date().toISOString();
 try{
  await writeFile(join(lock,'owner.json'),JSON.stringify({pid:process.pid,started}),{mode:0o600});
  const stamp=new Date().toISOString().replace(/[-:.]/g,''),name='salon-backup-'+stamp+'-'+randomUUID()+'.sqlite';snapshotPath=join(dir,name);tmp=await mkdtemp(join(dir,'.backup-work-'));await chmod(tmp,0o700);const staging=join(tmp,'snapshot.sqlite');
  const db=new DatabaseSync(file,{readOnly:true});try{await backup(db,staging)}finally{db.close()}
  await chmod(staging,0o600);const counts=inspect(staging),sha256=await digest(staging);await rename(staging,snapshotPath);
  const manifest={format:1,file:name,created:started,sha256,bytes:(await stat(snapshotPath)).size,counts};await jsonAtomic(snapshotPath+'.json',manifest);
  // Reopen a separately restored file, rather than just trusting backup() success.
  await restoreCopy(snapshotPath,join(tmp,'restore-test.sqlite'));
  let offsite='not-configured';
  if(remote){if(!/^[A-Za-z0-9_-]+:[^\r\n]*$/.test(remote))throw Error('BACKUP_REMOTE must be a configured rclone remote:path');const prefix=remote.replace(/\/$/,'');const options={timeout:120000,maxBuffer:65536};try{
    await execute(rclone,['copyto',snapshotPath,prefix+'/'+name],options);
    await execute(rclone,['copyto',snapshotPath+'.json',prefix+'/'+name+'.json'],options);
    const downloaded=join(tmp,'remote-check.sqlite');await execute(rclone,['copyto',prefix+'/'+name,downloaded],options);
    if(await digest(downloaded)!==sha256)throw Error('Remote copy differs');offsite='download-verified';
   }catch{throw Error('Offsite transfer or read-back verification failed. Local backup retained. Check rclone configuration and remote access.')}
  }
  // Only prune our own complete, valid backup pairs, after this run succeeds.
  const candidates=(await readdir(dir)).filter(x=>pattern.test(x)).sort().reverse();let valid=0;
  for(const name of candidates){const path=join(dir,name);try{await verifyBackup(path)}catch{continue}if(++valid>keep){await unlink(path);await unlink(path+'.json')}}
  const status={ok:true,lastSuccess:new Date().toISOString(),file:basename(snapshotPath),restoreTest:'passed',offsite,retained:Math.min(valid,keep)};await jsonAtomic(statusPath,status);return status;
 }catch(e){let previous={};try{previous=JSON.parse(await readFile(statusPath,'utf8'))}catch{}await jsonAtomic(statusPath,{ok:false,lastSuccess:previous.lastSuccess||null,failedAt:new Date().toISOString(),error:e.message,localFile:snapshotPath?basename(snapshotPath):null}).catch(()=>{});throw e}
 finally{if(tmp)await rm(tmp,{recursive:true,force:true});await rm(lock,{recursive:true,force:true})}
}
if(process.argv[1]&&await realpath(process.argv[1]).catch(()=>null)===await realpath(fileURLToPath(import.meta.url))){
 process.umask(0o077);
 try{const [command='run',file,destination]=process.argv.slice(2);if(command==='run')console.log(JSON.stringify(await runBackup({file:process.env.DATABASE_FILE,dir:process.env.BACKUP_DIR,keep:Number(process.env.BACKUP_KEEP||168),remote:process.env.BACKUP_REMOTE||'',rclone:process.env.RCLONE_BIN||'rclone'})));else if(command==='verify')console.log(JSON.stringify(await verifyBackup(resolve(file))));else if(command==='restore-test'){if(!file||!destination)throw Error('Supply backup and a NEW destination file');console.log(JSON.stringify({ok:true,counts:await restoreCopy(resolve(file),resolve(destination))}));}else if(command==='status'){const status=JSON.parse(await readFile(join(process.env.BACKUP_DIR,'status.json'),'utf8'));const ageHours=(Date.now()-Date.parse(status.lastSuccess))/3600000;console.log(JSON.stringify({...status,ageHours}));if(!status.ok||!Number.isFinite(ageHours)||ageHours>2)process.exitCode=1;}else throw Error('Commands: run | verify <file> | restore-test <backup> <new-file> | status');
 }catch(e){console.error('BACKUP ERROR: '+e.message);process.exitCode=1}
}
