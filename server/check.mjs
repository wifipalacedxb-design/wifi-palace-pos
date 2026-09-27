// Shared validation helpers used by the core rules and by business modules.
export class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
export const fail=(message,status=400)=>{throw new ApiError(status,message)};
export const text=(v,max=150)=>{if(typeof v!=='string'||v.length>max)fail('Invalid text field');return v.trim()};
export const required=(v,max)=>{const r=text(v,max);if(!r)fail('Required field is empty');return r};
export const amount=v=>{if(!Number.isSafeInteger(v)||v<0||v>100000000)fail('Invalid amount');return v};
export const image=v=>{if(!v)return '';if(typeof v!=='string'||v.length>1500000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v))fail('Invalid logo');return v};
export const get=(db,business,kind,id)=>{const r=db.prepare('SELECT * FROM records WHERE business_id=? AND kind=? AND id=?').get(business,kind,id);return r?.data?JSON.parse(r.data):null;};

// Records made offline can arrive late: accept event dates up to the longest offline period (30 days) + margin.
export const OFFLINE_GRACE_DAYS=32;
