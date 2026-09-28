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
// Which backups to keep. Tiered by default: the newest `hourly` copies, plus the newest copy of each of the last
// `daily` days and of each of the last `weekly` weeks (UAE time). A plain number keeps the newest N (older setting).
const stampOf=name=>{const m=/^salon-backup-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z-/.exec(name);return m?Date.UTC(+m[1],m[2]-1,+m[3],+m[4],+m[5],+m[6],+m[7]):NaN};
const uaeDay=t=>new Date(t+4*3600000).toISOString().slice(0,10);
const uaeWeek=t=>{const d=new Date(t+4*3600000);d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10)}; // Monday of that week
export function retentionPlan(names,policy){
 const list=names.filter(n=>Number.isFinite(stampOf(n))).sort((a,b)=>stampOf(b)-stampOf(a)),keep=new Set();
 if(typeof policy==='number'){list.slice(0,policy).forEach(n=>keep.add(n));return{keep,remove:list.filter(n=>!keep.has(n))}}
 const {hourly=48,daily=30,weekly=12}=policy||{};
 list.slice(0,hourly).forEach(n=>keep.add(n));
 const newestPer=(fn,count)=>{const seen=new Set();for(const n of list){const k=fn(stampOf(n));if(seen.has(k))continue;seen.add(k);if(seen.size>count)break;keep.add(n)}};
 newestPer(uaeDay,daily);newestPer(uaeWeek,weekly);
 return{keep,remove:list.filter(n=>!keep.has(n))};
}
export async function runBackup({file,dir,keep,hourly=48,daily=30,weekly=12,remote='',rclone='rclone'}={}){
 if(!file||!dir)throw Error('DATABASE_FILE and BACKUP_DIR must be configured');
 if(keep!==undefined&&(!Number.isInteger(keep)||keep<2||keep>10000))throw Error('BACKUP_KEEP must be 2–10000');
 for(const [k,v,max] of [['BACKUP_HOURLY',hourly,10000],['BACKUP_DAILY',daily,3650],['BACKUP_WEEKLY',weekly,520]])if(!Number.isInteger(v)||v<(k==='BACKUP_HOURLY'?2:0)||v>max)throw Error(k+' must be a whole number (hourly at least 2)');
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
  // Prune only after this run fully succeeded (checksum + test restore above). Only our own complete pairs
  // (backup + manifest) are considered; the newest backup is never removed. Older copies are not re-hashed every
  // hour (that would read the whole backup folder each run); their manifests identify them.
  const names=[];for(const name of (await readdir(dir)).filter(x=>pattern.test(x))){try{const m=JSON.parse(await readFile(join(dir,name+'.json'),'utf8'));if(m.format===1&&m.file===name&&(await stat(join(dir,name))).size===m.bytes)names.push(name)}catch{}}
  const plan=retentionPlan(names,keep!==undefined?keep:{hourly,daily,weekly});plan.keep.add(basename(snapshotPath));
  for(const name of plan.remove){if(plan.keep.has(name))continue;await unlink(join(dir,name));await unlink(join(dir,name+'.json')).catch(()=>{})}
  const status={ok:true,lastSuccess:new Date().toISOString(),file:basename(snapshotPath),restoreTest:'passed',offsite,retained:plan.keep.size,policy:keep!==undefined?{keep}:{hourly,daily,weekly}};await jsonAtomic(statusPath,status);return status;
 }catch(e){let previous={};try{previous=JSON.parse(await readFile(statusPath,'utf8'))}catch{}await jsonAtomic(statusPath,{ok:false,lastSuccess:previous.lastSuccess||null,failedAt:new Date().toISOString(),error:e.message,localFile:snapshotPath?basename(snapshotPath):null}).catch(()=>{});throw e}
 finally{if(tmp)await rm(tmp,{recursive:true,force:true});await rm(lock,{recursive:true,force:true})}
}
if(process.argv[1]&&await realpath(process.argv[1]).catch(()=>null)===await realpath(fileURLToPath(import.meta.url))){
 process.umask(0o077);
 try{const [command='run',file,destination]=process.argv.slice(2);if(command==='run')console.log(JSON.stringify(await runBackup({file:process.env.DATABASE_FILE,dir:process.env.BACKUP_DIR,keep:process.env.BACKUP_KEEP?Number(process.env.BACKUP_KEEP):undefined,hourly:Number(process.env.BACKUP_HOURLY||48),daily:Number(process.env.BACKUP_DAILY||30),weekly:Number(process.env.BACKUP_WEEKLY||12),remote:process.env.BACKUP_REMOTE||'',rclone:process.env.RCLONE_BIN||'rclone'})));else if(command==='verify')console.log(JSON.stringify(await verifyBackup(resolve(file))));else if(command==='restore-test'){if(!file||!destination)throw Error('Supply backup and a NEW destination file');console.log(JSON.stringify({ok:true,counts:await restoreCopy(resolve(file),resolve(destination))}));}else if(command==='status'){const status=JSON.parse(await readFile(join(process.env.BACKUP_DIR,'status.json'),'utf8'));const ageHours=(Date.now()-Date.parse(status.lastSuccess))/3600000;console.log(JSON.stringify({...status,ageHours}));if(!status.ok||!Number.isFinite(ageHours)||ageHours>2)process.exitCode=1;}else throw Error('Commands: run | verify <file> | restore-test <backup> <new-file> | status');
 }catch(e){console.error('BACKUP ERROR: '+e.message);process.exitCode=1}
}
