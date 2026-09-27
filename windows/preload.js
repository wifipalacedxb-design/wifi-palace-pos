'use strict';
// Gives the POS page the same native bridge the Android app provides (window.Android), so the web screens
// work unchanged, plus window.WinPOS for Windows-only printer settings. Runs only for the trusted POS site;
// the main process checks the sender again for every call.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

const reply = (id, error) => webFrame.executeJavaScript(`window.onPrinterResult&&window.onPrinterResult(${JSON.stringify(String(id || ''))},${error ? JSON.stringify(String(error)) : 'null'})`).catch(() => {});
const loadImage = src => new Promise(resolve => { if (!src || !/^data:image\/(png|jpeg|webp);base64,/.test(src) || src.length > 1500000) { resolve(null); return; } const img = new Image(); img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = src; });

// Draws the receipt (logo + monospace text, 32 characters across) and converts it to 1-bit printer rows.
async function renderReceipt(text, logo, paperMm) {
  const width = paperMm === 58 ? 384 : 576, margin = 8, textWidth = width - margin * 2;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = 'bold 100px Consolas, "Courier New", monospace';
  const size = Math.max(14, Math.floor(10 * textWidth / (32.6 * (probe.measureText('0').width / 100))) / 10);
  const font = `bold ${size.toFixed(1)}px Consolas, "Courier New", "Segoe UI", Tahoma, monospace`;
  probe.font = font;
  const lines = [];
  for (const raw of String(text || '').split('\n')) {
    let line = '';
    for (const ch of raw) { if (probe.measureText(line + ch).width > textWidth && line) { lines.push(line); line = ch; } else line += ch; }
    lines.push(line);
  }
  const img = await loadImage(logo);
  let logoW = 0, logoH = 0;
  if (img) { logoW = Math.min(img.width, Math.round(width * 0.6)); logoH = Math.min(200, Math.round(img.height * logoW / img.width)); logoW = Math.round(img.width * logoH / img.height); }
  const lineH = Math.round(size * 1.18), height = margin + (logoH ? logoH + 16 : 0) + lines.length * lineH + margin;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, width, height);
  let y = margin;
  if (img && logoH) { g.drawImage(img, Math.round((width - logoW) / 2), y, logoW, logoH); y += logoH + 16; }
  g.fillStyle = '#000'; g.font = font; g.textBaseline = 'top';
  for (const l of lines) { g.fillText(l, margin, y); y += lineH; }
  const px = g.getImageData(0, 0, width, height).data, bytesPerRow = Math.ceil(width / 8), bits = new Uint8Array(bytesPerRow * height);
  for (let r = 0; r < height; r++) for (let x = 0; x < width; x++) {
    const i = (r * width + x) * 4, lum = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    if (px[i + 3] > 128 && lum < 140) bits[r * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
  }
  return { width, height, bits };
}

function receiptHtml(text, logo) {
  const esc = s => String(s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const img = logo && /^data:image\/(png|jpeg|webp);base64,/.test(logo) ? `<img src="${logo}" style="display:block;margin:0 auto 8px;max-width:60%;max-height:30mm">` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:80mm auto;margin:0}body{margin:0;padding:3mm;width:72mm;font:bold 11px Consolas,"Courier New",monospace;color:#000}pre{white-space:pre-wrap;margin:0;font:inherit}</style></head><body>${img}<pre>${esc(text)}</pre></body></html>`;
}

contextBridge.exposeInMainWorld('Android', {
  // LAN thermal printer (ESC/POS over TCP 9100). Result arrives via window.onPrinterResult(id, error|null).
  printNetwork(requestId, host, paperMm, text, logo, cut) {
    if (typeof text !== 'string' || text.length > 20000) { reply(requestId, 'Receipt is too long to print'); return; }
    renderReceipt(text, logo, Number(paperMm) === 58 ? 58 : 80)
      .then(img => ipcRenderer.invoke('pos:print-network', { host: String(host || ''), ...img, cut: cut !== false }))
      .then(() => reply(requestId, null), e => reply(requestId, (e && e.message || 'Printing failed').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')));
  },
  // Windows / USB printer: silent when a printer is chosen in Settings, otherwise the print dialog.
  printReceipt(text, logo) { ipcRenderer.invoke('pos:print-html', receiptHtml(text, logo)).catch(e => alert(String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))); },
  printText(text) { this.printReceipt(text, ''); },
  exportFile(name, text) { ipcRenderer.invoke('pos:save-file', { name: String(name || ''), text: String(text ?? '') }).catch(() => {}); },
  chooseLogo(kind) { if (kind === 'salon' || kind === 'vendor') document.getElementById(kind + 'File')?.click(); },
  restoreBackup() { alert('Restoring an offline backup is not available in the cloud edition.'); },
  save() { return false; } // the cloud edition stores data itself; the old single-device mode is not used on Windows
});

contextBridge.exposeInMainWorld('WinPOS', {
  printers: () => ipcRenderer.invoke('pos:printers'),
  config: () => ipcRenderer.invoke('pos:config'),
  setWindowsPrinter: name => ipcRenderer.invoke('pos:set-windows-printer', String(name || ''))
});
