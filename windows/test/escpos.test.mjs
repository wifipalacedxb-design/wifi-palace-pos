import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {checkPrinterAddress,buildJob}=createRequire(import.meta.url)('../escpos.js');
test('only shop-network printer addresses are allowed',()=>{
 for(const ok of ['192.168.1.50','10.0.0.9','172.16.0.1','172.31.255.254'])assert.equal(checkPrinterAddress(ok),ok);
 for(const bad of ['8.8.8.8','172.32.0.1','127.0.0.1','192.168.1.256','printer.local','',null])assert.throws(()=>checkPrinterAddress(bad));
});
test('ESC/POS job: init, banded raster, feed, cut, optional drawer pulse',()=>{
 const width=576,height=300,bits=new Uint8Array(72*height).fill(0xAA);
 const job=buildJob({width,height,bits,cut:true,drawer:true});
 assert.deepEqual([...job.subarray(0,2)],[0x1b,0x40]);
 assert.deepEqual([...job.subarray(2,10)],[0x1d,0x76,0x30,0x00,72,0,128,0]); // first band 128 rows
 assert.deepEqual([...job.subarray(-5)],[0x1b,0x70,0x00,0x19,0xfa]);
 assert.equal(job.length,2+3*8+72*300+3+4+5);
 assert.throws(()=>buildJob({width,height,bits:new Uint8Array(10)}),/mismatch/);
 assert.equal(buildJob({width,height,bits,cut:false}).includes(Buffer.from([0x1d,0x56])),false);
});
