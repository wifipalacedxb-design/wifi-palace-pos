(function(root){
 const clone=x=>JSON.parse(JSON.stringify(x));
 const kinds=['settings','vendor','services','staff','customers','appointments','sales'];
 const records=(state,kind)=>Array.isArray(state[kind])?Object.fromEntries(state[kind].map(x=>[x.id,x])):{singleton:state[kind]||{logo:''}};
 function apply(state,op){if(Array.isArray(state[op.kind])){const i=state[op.kind].findIndex(x=>x.id===op.key);if(op.data===null){if(i>=0)state[op.kind].splice(i,1)}else if(i>=0)state[op.kind][i]=clone(op.data);else state[op.kind].push(clone(op.data))}else if(op.data!==null)state[op.kind]=clone(op.data);return state}
 function project(cache){const state=clone(cache.base);for(const op of cache.pending)apply(state,{...op,data:op.action==='delete'?null:op.data});return state}
 function diff(before,after,cache,newId){const ops=[];for(const kind of kinds){const a=records(before,kind),b=records(after,kind);for(const key of new Set([...Object.keys(a),...Object.keys(b)])){if(JSON.stringify(a[key])===JSON.stringify(b[key]))continue;const recordKey=kind+':'+key,base=(cache.revisions[recordKey]||0)+cache.pending.filter(x=>x.kind===kind&&x.key===key).length;ops.push({id:newId(),kind,key,base,action:b[key]===undefined?'delete':'put',...(b[key]===undefined?{}:{data:clone(b[key])})})}}return ops}
 function ack(cache,result){const op=cache.pending.find(x=>x.id===result.id);if(!op)throw Error('Unknown acknowledgement');apply(cache.base,result);cache.revisions[result.kind+':'+result.key]=result.version;cache.pending=cache.pending.filter(x=>x.id!==result.id);return cache}
 root.SyncCore={clone,project,diff,ack,apply};
})(globalThis);
