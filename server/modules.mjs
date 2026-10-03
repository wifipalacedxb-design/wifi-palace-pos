// Business-type registry. Each module adds its own record kinds, seed data and validation;
// the core (accounts, sync, customers, staff, sales, finance) is shared by every type.
import {salon} from './modules/salon.mjs';
import {laundry} from './modules/laundry.mjs';
import {gym} from './modules/gym.mjs';
import {grocery} from './modules/grocery.mjs';
import {restaurant} from './modules/restaurant.mjs';
import {petshop} from './modules/petshop.mjs';
import {perfume} from './modules/perfume.mjs';
import {meat} from './modules/meat.mjs';
import {mobile} from './modules/mobile.mjs';
import {tailor} from './modules/tailor.mjs';
import {electronics} from './modules/electronics.mjs';
export const CORE_KINDS=['settings','vendor','staff','customers','sales'];
export const CORE_OWNER_KINDS=['settings','vendor','staff'];
export const MODULES={salon,laundry,gym,grocery,restaurant,petshop,perfume,meat,mobile,tailor,electronics};
export const BUSINESS_TYPES=Object.keys(MODULES);
export function businessModule(type='salon'){const m=Object.hasOwn(MODULES,type)?MODULES[type]:null;if(!m)throw Error('Unknown business type: '+type);return m}
export function checkBusinessType(type){const t=type===undefined||type===null||type===''?'salon':type;if(typeof t!=='string'||!Object.hasOwn(MODULES,t))throw Error('Choose a supported business type.');return t}
export const kindsFor=type=>[...CORE_KINDS,...businessModule(type).kinds];
