import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,readdir,readFile,writeFile,mkdir,stat} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {start} from '../server/server.mjs';import {createSalon} from '../server/store.mjs';import {runBackup,restoreCopy,verifyBackup} from '../server/backup.mjs';
async function setup(t){const dir=await mkdtemp(join(tmpdir(),'salon-backup-')),file=join(dir,'live.sqlite'),backups=join(dir,'backups');const app=await start({file,port:0,mailer:null});await createSalon(app.db,{name:'Restore Salon',slug:'restore-salon',email:'owner@test.com',owner:'Owner',password:'restore-password-123'});t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true})});return{dir,file,backups,app}}
test('online WAL snapshot restores a working login and records without changing live database',async t=>{const f=await setup(t);const before=f.app.db.prepare('SELECT count(*) n FROM records').get().n;const result=await runBackup({file:f.file,dir:f.backups});assert.equal(result.restoreTest,'passed');assert.equal(result.offsite,'not-configured');const snapshot=join(f.backups,result.file),manifest=await verifyBackup(snapshot);assert.equal(manifest.counts.records,before);assert.equal((await stat(snapshot)).mode&0o777,0o600);const restored=join(f.dir,'restored.sqlite');await restoreCopy(snapshot,restored);await assert.rejects(()=>restoreCopy(snapshot,restored),/EEXIST/);const recovered=await start({file:restored,port:0,mailer:null});try{const base='http://127.0.0.1:'+recovered.server.address().port;const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({salon:'restore-salon',email:'owner@test.com',password:'restore-password-123'})});assert.equal(r.status,200);const state=await fetch(base+'/api/state',{headers:{Cookie:r.headers.get('set-cookie').split(';')[0]}});assert.equal((await state.json()).state.settings.name,'Restore Salon')}finally{await recovered.close()}assert.equal(f.app.db.prepare('SELECT count(*) n FROM records').get().n,before)});
test('retention removes only verified generated pairs and preserves unrelated files',async t=>{const f=await setup(t);await mkdir(f.backups);await writeFile(join(f.backups,'manual.sqlite'),'keep');for(let i=0;i<3;i++)await runBackup({file:f.file,dir:f.backups,keep:2});const names=await readdir(f.backups);assert.equal(names.filter(n=>n.startsWith('salon-backup-')&&n.endsWith('.sqlite')).length,2);assert.equal(await readFile(join(f.backups,'manual.sqlite'),'utf8'),'keep')});
test('missing source, overlapping jobs and corruption fail safely',async t=>{const f=await setup(t);await assert.rejects(()=>runBackup({file:join(f.dir,'missing'),dir:f.backups}),/ENOENT/);await assert.rejects(()=>stat(join(f.dir,'missing')),/ENOENT/);const result=await runBackup({file:f.file,dir:f.backups});const path=join(f.backups,result.file);await writeFile(path,'corrupt');await assert.rejects(()=>restoreCopy(path,join(f.dir,'unsafe.sqlite')),/checksum/);await assert.rejects(()=>stat(join(f.dir,'unsafe.sqlite')),/ENOENT/);await mkdir(join(f.backups,'.backup-lock'));await assert.rejects(()=>runBackup({file:f.file,dir:f.backups}),/lock exists/)});
test('offsite failure is not reported as success and keeps the local snapshot',async t=>{const f=await setup(t);await assert.rejects(()=>runBackup({file:f.file,dir:f.backups,remote:'archive:salon',rclone:'/does/not/exist'}),/Offsite/);const status=JSON.parse(await readFile(join(f.backups,'status.json'),'utf8'));assert.equal(status.ok,false);await verifyBackup(join(f.backups,status.localFile));assert.equal((await readdir(f.backups)).includes('.backup-lock'),false)});

test('CLI runs through deployment directory symlink',async t=>{
 const f=await setup(t);
 const {symlink}=await import('node:fs/promises');
 const {fileURLToPath}=await import('node:url');
 const {execFile}=await import('node:child_process');
 const {promisify}=await import('node:util');
 const link=join(f.dir,'current');
 await symlink(fileURLToPath(new URL('../server/',import.meta.url)),link,'dir');
 const result=await promisify(execFile)(process.execPath,[join(link,'backup.mjs'),'run'],{env:{...process.env,DATABASE_FILE:f.file,BACKUP_DIR:f.backups,BACKUP_REMOTE:'',BACKUP_KEEP:'2'}});
 assert.equal(JSON.parse(result.stdout).ok,true);
 const status=JSON.parse(await readFile(join(f.backups,'status.json'),'utf8'));
 assert.equal(status.restoreTest,'passed');
 await verifyBackup(join(f.backups,status.file));
});

test('tiered retention: 48 hourly, one per day for 30 days, one per week for 12 weeks (UAE time)',async()=>{
 const {retentionPlan}=await import('../server/backup.mjs');
 const name=t=>'salon-backup-'+new Date(t).toISOString().replace(/[-:.]/g,'')+'-'+crypto.randomUUID()+'.sqlite';
 const now=Date.UTC(2026,8,29,20,45),names=[];for(let h=0;h<24*120;h++)names.push(name(now-h*3600000)); // 120 days of hourly backups
 const {keep,remove}=retentionPlan(names,{hourly:48,daily:30,weekly:12});
 assert.ok(keep.has(names[0]),'newest kept');for(let i=0;i<48;i++)assert.ok(keep.has(names[i]),'hourly '+i);
 const days=new Set([...keep].map(n=>n.slice(13,21)));assert.ok(days.size>=30);
 assert.ok(keep.size>=48+28&&keep.size<=48+30+12,'kept '+keep.size);assert.equal(keep.size+remove.length,names.length);
 const oldest=Math.min(...[...keep].map(n=>Date.UTC(+n.slice(13,17),+n.slice(17,19)-1,+n.slice(19,21))));assert.ok(now-oldest>=10*7*86400000,'weekly copies reach back about 11-12 weeks (the current week counts as one)');
 assert.equal(retentionPlan(names,5).keep.size,5); // old number setting still works
 assert.equal(retentionPlan(['manual.sqlite','salon-backup-bad.sqlite'],{}).keep.size,0); // foreign files are never considered
});
