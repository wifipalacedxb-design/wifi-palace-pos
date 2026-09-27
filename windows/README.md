# WiFi Palace POS for Windows

A Windows program around the hosted POS (https://pos.wifipalace.in). The POS screens load from the
server (so they update automatically); the program adds what a browser can't do well on a counter.

| Feature | How |
| --- | --- |
| Direct receipt printing, LAN | Settings → Receipt printer → printer IP (POSWAY CPQ 2/3, port 9100). No dialog; Arabic and logo print as an image |
| Direct receipt printing, USB | Install the printer's Windows driver, then Settings → Windows / USB printer. Prints without the dialog |
| Cash drawer | POS menu → "Open cash drawer after each receipt" (LAN printers). USB printers: enable in the Windows driver |
| Counter mode | POS menu → Full screen (F11); Start with Windows |
| Offline | Same as the web app (up to the period set per business in /admin). Data lives in the program's own folder (`%APPDATA%\WiFi Palace POS`), not the browser, so clearing browser history can't delete unsynced sales |
| Safety | Only pos.wifipalace.in loads inside the window; other links open in the normal browser. Camera, microphone and location are denied |

## Get the installer

GitHub → Actions → **Windows app** → latest run → Artifacts → `wifi-palace-pos-windows` → unzip →
`WiFiPalacePOS-Setup-<version>.exe`. The build runs automatically when anything in `windows/` changes;
use **Run workflow** to build on demand.

Unsigned builds show a Windows SmartScreen warning ("More info → Run anyway"). To remove it, buy a
code-signing certificate and add it as repository secrets `CSC_LINK` (base64 .pfx) and `CSC_KEY_PASSWORD`,
then delete `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` from `.github/workflows/windows.yml`.

## Develop

```
cd windows
npm install
npm start                                   # opens https://pos.wifipalace.in
npx electron . --pos-url=http://localhost:8080/   # against a local server
npm test
```
