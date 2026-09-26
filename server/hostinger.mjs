// Hosting loaders import this entry point instead of executing server.mjs directly.
import {start} from './server.mjs';

const app = await start();
console.log('Salon Cloud listening on port ' + app.server.address().port);
export default app.server;
