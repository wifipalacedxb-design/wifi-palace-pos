// Restaurant ingredients, recipes and food cost (owner, online).
// * Ingredients with unit, latest cost and a minimum level.
// * A recipe per menu item: how much of each ingredient one portion uses.
// * Stock of an ingredient = the last stock count (or 0 when the ingredient was created) + deliveries − waste
//   − what paid, un-refunded bills used since then according to the recipes. Nothing is stored per sale, so
//   refunds and recipe corrections are reflected automatically.
// * Supplier invoice: adds the stock, updates the costs and records the purchase bill with VAT in one step.
import {ApiError} from './rules.mjs';
import {audit} from './store.mjs';
import {businessDay} from './finance.mjs';
import {recordBill} from './accounts.mjs';
const fail=(s,m)=>{throw new ApiError(s,m)};
const key=v=>{if(typeof v!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(v))fail(400,'Invalid request identifier');return v};
const money=(v,label='amount')=>{if(!Number.isSafeInteger(v)||v<0||v>100000000)fail(400,'Enter a valid '+label);return v};
const qty=(v,label='Quantity',min=0.001)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>1000000||Math.abs(Math.round(v*1000)-v*1000)>1e-6)fail(400,label+' must be a number with up to 3 decimals');return v};
const text=(v,max,label)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail(400,'Enter '+label);return v.trim()};
const opt=(v,max=200)=>typeof v==='string'?v.trim().slice(0,max):'';
const r3=n=>Math.round(n*1000)/1000;
export const UNITS=['kg','g','l','ml','piece'];
export function initRecipes(db){db.exec(`
CREATE TABLE IF NOT EXISTS ingredients(business_id TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,unit TEXT NOT NULL,cost INTEGER NOT NULL,min_stock REAL NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,PRIMARY KEY(business_id,id));
CREATE TABLE IF NOT EXISTS recipes(business_id TEXT NOT NULL,item_id TEXT NOT NULL,lines TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(business_id,item_id));
CREATE TABLE IF NOT EXISTS ingredient_moves(business_id TEXT NOT NULL,id TEXT NOT NULL,ingredient_id TEXT NOT NULL,type TEXT NOT NULL,qty REAL NOT NULL,cost INTEGER NOT NULL DEFAULT 0,note TEXT NOT NULL DEFAULT '',at TEXT NOT NULL,by_user TEXT NOT NULL,PRIMARY KEY(business_id,id));
CREATE INDEX IF NOT EXISTS ingredient_moves_item ON ingredient_moves(business_id,ingredient_id,at);
`)}
const records=(db,b,kind)=>db.prepare('SELECT data FROM records WHERE business_id=? AND kind=? AND data IS NOT NULL').all(b,kind).map(r=>JSON.parse(r.data));
const recipeMap=(db,b)=>new Map(db.prepare('SELECT item_id,lines FROM recipes WHERE business_id=?').all(b).map(r=>[r.item_id,JSON.parse(r.lines)]));
// Stock and usage for every ingredient. `from`/`to` (UAE days) also total the usage inside a period.
export function kitchenStock(db,b,from='',to=''){
 const ing=db.prepare('SELECT * FROM ingredients WHERE business_id=? ORDER BY active DESC,name COLLATE NOCASE').all(b),recipes=recipeMap(db,b),moves=db.prepare('SELECT * FROM ingredient_moves WHERE business_id=? ORDER BY at').all(b);
 const state=new Map(ing.map(i=>[i.id,{base:0,since:i.created_at,in:0,waste:0,used:0,periodUsed:0}]));
 for(const m of moves){const s=state.get(m.ingredient_id);if(!s)continue;if(m.type==='count'){s.base=m.qty;s.since=m.at;s.in=0;s.waste=0}else if(m.type==='in')s.in+=m.qty;else if(m.type==='waste')s.waste+=m.qty}
 let netSales=0,recipeSales=0; // recipeSales: sales of dishes that have a recipe, so food cost % is not diluted by dishes without one
 for(const s of records(db,b,'sales')){if(s.status!=='Paid')continue;const day=businessDay(s.date),inPeriod=from&&day>=from&&day<=to;if(inPeriod)netSales+=s.sub-s.off;
  for(const line of s.items||[]){const r=recipes.get(line.id);if(!r)continue;if(inPeriod)recipeSales+=Math.round(line.price*line.qty);for(const x of r){const st=state.get(x.ingredientId);if(!st)continue;const used=x.qty*line.qty;if(s.date>st.since)st.used+=used;if(inPeriod)st.periodUsed+=used}}}
 const list=ing.map(i=>{const s=state.get(i.id),stock=r3(s.base+s.in-s.waste-s.used);return{id:i.id,name:i.name,unit:i.unit,cost:i.cost,minStock:i.min_stock,active:!!i.active,stock,value:Math.round(Math.max(0,stock)*i.cost),low:!!i.active&&stock<=i.min_stock&&i.min_stock>0,periodUsed:r3(s.periodUsed),periodCost:Math.round(s.periodUsed*i.cost)}});
 return{ingredients:list,netSales,recipeSales,usageCost:list.reduce((n,i)=>n+i.periodCost,0),stockValue:list.reduce((n,i)=>n+i.value,0)};
}
export async function recipesRoute({db,u,req,res,path,body,send}){
 if(!path.startsWith('/api/recipes/'))return false;
 if(u.role!=='owner')fail(403,'Owner permission required');if(u.business_type!=='restaurant')fail(404,'Recipes are for restaurants');
 const b=u.business_id,today=businessDay();
 const txn=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}};
 const ingredient=id=>db.prepare('SELECT * FROM ingredients WHERE business_id=? AND id=?').get(b,id)||fail(404,'Ingredient not found');
 if(path==='/api/recipes/overview'&&req.method==='GET'){
  const q=new URL(req.url,'http://local').searchParams,from=q.get('from')||today.slice(0,8)+'01',to=q.get('to')||today;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)fail(400,'Choose a valid period');
  const k=kitchenStock(db,b,from,to),cost=new Map(k.ingredients.map(i=>[i.id,i])),recipes=recipeMap(db,b);
  const menu=records(db,b,'restaurant_items').filter(i=>!i.system).sort((x,y)=>(x.category||'').localeCompare(y.category||'')||x.name.localeCompare(y.name)).map(i=>{const lines=(recipes.get(i.id)||[]).filter(l=>cost.has(l.ingredientId)).map(l=>({ingredientId:l.ingredientId,name:cost.get(l.ingredientId).name,unit:cost.get(l.ingredientId).unit,qty:l.qty,cost:Math.round(l.qty*cost.get(l.ingredientId).cost)})),c=lines.reduce((n,l)=>n+l.cost,0);
   return{id:i.id,name:i.name,category:i.category,price:i.price,lines,cost:c,margin:i.price-c,foodCostPct:i.price&&lines.length?Math.round(c/i.price*1000)/10:null}});
  send(res,200,{from,to,units:UNITS,...k,foodCostPct:k.recipeSales?Math.round(k.usageCost/k.recipeSales*1000)/10:null,menu,
   moves:db.prepare('SELECT m.type,m.qty,m.cost,m.note,m.at,i.name,i.unit FROM ingredient_moves m JOIN ingredients i ON i.business_id=m.business_id AND i.id=m.ingredient_id WHERE m.business_id=? ORDER BY m.at DESC LIMIT 40').all(b)});return true}
 if(req.method!=='POST')return false;
 const d=await body(req),now=new Date().toISOString();
 if(path==='/api/recipes/ingredients'){
  const id=key(d.id),name=text(d.name,80,'the ingredient name'),unit=UNITS.includes(d.unit)?d.unit:fail(400,'Choose a unit'),cost=money(d.cost??0,'cost per '+unit),min=d.minStock?qty(d.minStock,'Minimum level',0):0,active=d.active===false?0:1;
  txn(()=>{const old=db.prepare('SELECT unit FROM ingredients WHERE business_id=? AND id=?').get(b,id);
   if(old&&old.unit!==unit&&db.prepare('SELECT 1 FROM ingredient_moves WHERE business_id=? AND ingredient_id=?').get(b,id))fail(409,'The unit cannot change after stock was recorded. Add a new ingredient instead.');
   if(db.prepare('SELECT 1 FROM ingredients WHERE business_id=? AND lower(name)=lower(?) AND id<>?').get(b,name,id))fail(409,'An ingredient with this name already exists');
   db.prepare('INSERT INTO ingredients(business_id,id,name,unit,cost,min_stock,active,created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(business_id,id) DO UPDATE SET name=excluded.name,unit=excluded.unit,cost=excluded.cost,min_stock=excluded.min_stock,active=excluded.active').run(b,id,name,unit,cost,min,active,now);audit(db,u,old?'ingredient-updated':'ingredient-added',name)});
  send(res,200,{ok:true,id});return true;
 }
 if(path==='/api/recipes/recipe'){
  const itemId=key(d.itemId);if(!db.prepare("SELECT 1 FROM records WHERE business_id=? AND kind='restaurant_items' AND id=? AND data IS NOT NULL").get(b,itemId))fail(404,'Menu item not found');
  if(!Array.isArray(d.lines)||d.lines.length>40)fail(400,'A recipe has up to 40 ingredients');
  const lines=d.lines.map(l=>({ingredientId:ingredient(key(l?.ingredientId)).id,qty:qty(l.qty,'Quantity per portion')}));if(new Set(lines.map(l=>l.ingredientId)).size!==lines.length)fail(400,'List each ingredient once');
  if(lines.length)db.prepare('INSERT INTO recipes VALUES (?,?,?,?) ON CONFLICT(business_id,item_id) DO UPDATE SET lines=excluded.lines,updated_at=excluded.updated_at').run(b,itemId,JSON.stringify(lines),now);else db.prepare('DELETE FROM recipes WHERE business_id=? AND item_id=?').run(b,itemId);
  audit(db,u,'recipe-saved',itemId);send(res,200,{ok:true});return true;
 }
 // Stock count (sets the level), waste (takes off) or a quick delivery without a bill.
 if(path==='/api/recipes/moves'){
  const id=key(d.id),i=ingredient(key(d.ingredientId)),type=['count','waste','in'].includes(d.type)?d.type:fail(400,'Choose count, waste or delivery'),n=qty(d.qty,'Quantity',type==='count'?0:0.001),note=type==='in'?opt(d.note):text(d.note,200,'a reason');
  db.prepare('INSERT OR IGNORE INTO ingredient_moves(business_id,id,ingredient_id,type,qty,cost,note,at,by_user) VALUES (?,?,?,?,?,?,?,?,?)').run(b,id,i.id,type,n,type==='in'?money(d.cost??0,'cost'):0,note,now,u.id);
  if(type==='in'&&d.cost>0)db.prepare('UPDATE ingredients SET cost=? WHERE business_id=? AND id=?').run(d.cost,b,i.id);
  audit(db,u,'ingredient-'+type,i.name);send(res,201,{ok:true});return true;
 }
 if(path==='/api/recipes/receive'){
  if(!Array.isArray(d.lines)||d.lines.length<1||d.lines.length>60)fail(400,'Add 1 to 60 items');
  const lines=d.lines.map(l=>({i:ingredient(key(l?.ingredientId)),qty:qty(l.qty),cost:money(l.cost,'cost per unit')}));if(new Set(lines.map(l=>l.i.id)).size!==lines.length)fail(400,'List each ingredient once');if(lines.some(l=>!l.cost))fail(400,'Enter the cost per unit before VAT');
  const net=lines.reduce((n,l)=>n+Math.round(l.qty*l.cost),0),billId=key(d.billId);
  const status=txn(()=>{
   const st=recordBill(db,u,{id:billId,supplierId:d.supplierId,number:d.number,date:d.date,category:'Stock for resale',net,vat:d.vat??0,note:('Ingredients: '+lines.map(l=>l.qty+' '+l.i.unit+' '+l.i.name).join(', ')).slice(0,300),paid:d.paid});
   if(st===201)lines.forEach((l,k)=>{db.prepare("INSERT INTO ingredient_moves(business_id,id,ingredient_id,type,qty,cost,note,at,by_user) VALUES (?,?,?,'in',?,?,?,?,?)").run(b,billId+'-'+k,l.i.id,l.qty,l.cost,'Invoice '+String(d.number).slice(0,60),now,u.id);db.prepare('UPDATE ingredients SET cost=? WHERE business_id=? AND id=?').run(l.cost,b,l.i.id)});
   return st});
  send(res,status,{ok:true,net});return true;
 }
 return false;
}
