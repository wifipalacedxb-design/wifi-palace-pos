import {openStore,createSalon,passwordHash,backupTo} from './store.mjs';
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {resolve} from 'node:path';
import {initProvider,bootstrapProvider} from './provider.mjs';
const [command,arg]=process.argv.slice(2),file=process.env.DATABASE_FILE||resolve('data/salon.sqlite'),db=openStore(file);
const rl=createInterface({input:stdin,output:stdout});
initProvider(db);
async function secret(label){if(!stdin.isTTY)return await rl.question(label);const readline=await import('node:readline');stdout.write(label);readline.emitKeypressEvents(stdin);stdin.setRawMode(true);rl.pause();return new Promise((resolve,reject)=>{let value='';const onKey=(str,key)=>{if(key?.ctrl&&key.name==='c'){cleanup();reject(Error('Cancelled'))}else if(key?.name==='return'){cleanup();resolve(value)}else if(key?.name==='backspace'){value=value.slice(0,-1)}else if(str&&!key?.ctrl)value+=str;};const cleanup=()=>{stdin.off('keypress',onKey);stdin.setRawMode(false);stdout.write('\n');rl.resume()};stdin.on('keypress',onKey);stdin.resume()})}
try{
 if(command==='create-provider'){await bootstrapProvider(db,{name:await rl.question('WiFi Palace administrator name: '),email:await rl.question('Administrator email: '),password:await secret('Administrator password (12+ characters, hidden): ')});console.log('Administrator created. Open /admin on your app domain.');}
 else
 if(command==='create-salon'){const name=await rl.question('Salon name: '),slug=await rl.question('Salon code (lowercase): '),owner=await rl.question('Owner name: '),email=await rl.question('Owner email: '),password=await secret('Owner password (12+ characters, hidden): ');console.log(await createSalon(db,{name,slug,owner,email,password}))}
 else if(command==='list'){console.table(db.prepare('SELECT name,slug,active FROM businesses').all())}
 else if(command==='set-active'){if(!arg)throw Error('Supply salon code');const active=await rl.question('Set active? Enter yes or no: ');if(!['yes','no'].includes(active))throw Error('Enter yes or no');db.prepare('UPDATE businesses SET active=? WHERE slug=?').run(active==='yes'?1:0,arg);if(active==='no')db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT u.id FROM users u JOIN businesses s ON s.id=u.business_id WHERE s.slug=?)').run(arg);console.log('Status updated')}
 else if(command==='reset-password'){if(!arg)throw Error('Supply salon code');const email=await rl.question('Account email: '),user=db.prepare('SELECT u.id FROM users u JOIN businesses s ON s.id=u.business_id WHERE s.slug=? AND u.email=?').get(arg,email.toLowerCase());if(!user)throw Error('Account not found');const pw=await passwordHash(await secret('New password (hidden): '));db.prepare('UPDATE users SET password=? WHERE id=?').run(pw,user.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);console.log('Password reset; sessions revoked')}
 else if(command==='backup'){if(!arg)throw Error('Supply a new backup file path');await backupTo(db,resolve(arg));console.log('Database backup created')}
 else console.log('Commands: create-salon | list | set-active <salon-code> | reset-password <salon-code> | backup <file.sqlite>');
}catch(e){console.error(e.message);process.exitCode=1}finally{rl.close();db.close()}
