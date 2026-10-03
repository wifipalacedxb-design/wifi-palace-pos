(function(root){
 const clone=x=>JSON.parse(JSON.stringify(x));
 // Upload order matters: people and catalogue records before the bookings and sales that refer to them.
 const FIRST=['settings','vendor','staff','customers'],LAST=['sales'],AFTER_SALES=['gym_memberships','gym_pt','perfume_points','mobile_units','mobile_repairs'];
 const kindsOf=(...states)=>{const lists=states.flatMap(s=>Object.keys(s||{}).filter(k=>Array.isArray(s[k])));return [...new Set([...FIRST,...lists.filter(k=>!FIRST.includes(k)&&!LAST.includes(k)&&!AFTER_SALES.includes(k)),...LAST,...AFTER_SALES.filter(k=>lists.includes(k))])]};
 const records=(state,kind,list=Array.isArray(state[kind]))=>list?Object.fromEntries((state[kind]||[]).map(x=>[x.id,x])):{singleton:state[kind]||{logo:''}};
 function apply(state,op){if(Array.isArray(state[op.kind])){const i=state[op.kind].findIndex(x=>x.id===op.key);if(op.data===null){if(i>=0)state[op.kind].splice(i,1)}else if(i>=0)state[op.kind][i]=clone(op.data);else state[op.kind].push(clone(op.data))}else if(op.data!==null)state[op.kind]=clone(op.data);return state}
 function project(cache){const state=clone(cache.base);for(const op of cache.pending)apply(state,{...op,data:op.action==='delete'?null:op.data});return state}
 function diff(before,after,cache,newId){const ops=[];for(const kind of kindsOf(before,after)){const list=Array.isArray(before[kind])||Array.isArray(after[kind]),a=records(before,kind,list),b=records(after,kind,list);for(const key of new Set([...Object.keys(a),...Object.keys(b)])){if(JSON.stringify(a[key])===JSON.stringify(b[key]))continue;const recordKey=kind+':'+key,base=(cache.revisions[recordKey]||0)+cache.pending.filter(x=>x.kind===kind&&x.key===key).length;ops.push({id:newId(),kind,key,base,action:b[key]===undefined?'delete':'put',...(b[key]===undefined?{}:{data:clone(b[key])})})}}return ops}
 function ack(cache,result){const op=cache.pending.find(x=>x.id===result.id);if(!op)throw Error('Unknown acknowledgement');apply(cache.base,result);cache.revisions[result.kind+':'+result.key]=result.version;cache.pending=cache.pending.filter(x=>x.id!==result.id);return cache}
 root.SyncCore={clone,project,diff,ack,apply};
})(globalThis);
