'use strict';
// ESC/POS helpers shared by the Windows app (main process) and its tests. The receipt picture is drawn
// in the page (canvas) so Arabic and the logo print on any ESC/POS printer, then sent here as 1-bit rows.
const net = require('node:net');

/** Only printers on the shop's own network: private IPv4 (10.x, 172.16–31.x, 192.168.x), port 9100. */
function checkPrinterAddress(host, { allowLoopback = false } = {}) {
  if (typeof host !== 'string' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) throw new Error("Enter the printer's IP address, e.g. 192.168.1.50");
  const p = host.split('.').map(Number);
  if (p.some(n => n > 255)) throw new Error('Invalid printer IP address');
  const [a, b] = p;
  if (allowLoopback && host === '127.0.0.1') return host; // automated tests only
  if (!(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))) throw new Error('The printer must be on the shop network (10.x, 172.16–31.x or 192.168.x)');
  return host;
}

/** Builds the full job: init, raster in 128-row bands (GS v 0), feed, optional cut and cash-drawer pulse. */
function buildJob({ width, height, bits, cut = true, drawer = false }) {
  const bytesPerRow = Math.ceil(width / 8);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || width > 832 || height <= 0 || height > 20000) throw new Error('Invalid receipt image');
  if (!bits || bits.length !== bytesPerRow * height) throw new Error('Receipt image size mismatch');
  const parts = [Buffer.from([0x1b, 0x40])];
  for (let top = 0; top < height; top += 128) {
    const rows = Math.min(128, height - top);
    parts.push(Buffer.from([0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, rows & 0xff, (rows >> 8) & 0xff]));
    parts.push(Buffer.from(bits.subarray(top * bytesPerRow, (top + rows) * bytesPerRow)));
  }
  parts.push(Buffer.from([0x1b, 0x64, 0x04]));
  if (cut) parts.push(Buffer.from([0x1d, 0x56, 0x42, 0x00]));
  if (drawer) parts.push(Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa])); // ESC p 0: pulse drawer pin 2
  return Buffer.concat(parts);
}

function send(host, data, { port = 9100, timeoutMs = 5000, allowLoopback = false } = {}) {
  checkPrinterAddress(host, { allowLoopback });
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const fail = err => { socket.destroy(); reject(new Error(err && err.code === 'ECONNREFUSED' ? 'Printer refused the connection. Check it is on and the IP is correct.' : err && err.message === 'timeout' ? 'Printer did not answer. Check the IP address and network cable.' : (err && err.message) || 'Printing failed')); };
    socket.setTimeout(timeoutMs, () => fail(new Error('timeout')));
    socket.on('error', fail);
    socket.on('connect', () => socket.end(data, () => resolve()));
  });
}

module.exports = { checkPrinterAddress, buildJob, send };
