# Salon Desk Cloud Android shell

This is the Android source project for the hosted cloud application. It has not been compiled or installed in this environment.

1. Deploy the cloud server and confirm it is reachable over HTTPS.
2. The HOME constant in `app/src/main/java/com/wifipalace/salonpos/MainActivity.java` is configured for `https://wifipalace.in/`. Sign in with the salon code, email and password created through the provider console.
3. Open this `android` directory as a project in Android Studio.
4. Use JDK 17, Gradle 8.9, Android platform 35 and Android Gradle Plugin 8.7.3. Generate a wrapper if needed using an installed Gradle: `gradle wrapper --gradle-version 8.9`.
5. Build with `gradle :app:assembleDebug` or Android Studio's APK build action.
6. Test `app/build/outputs/apk/debug/app-debug.apk` on the intended device.

Use a stable private release signing key for distribution. The included GitHub Actions workflow builds a test APK when this Android directory is the repository root; it has not been run.

Minimum Android version: Android 8.0 (API 26). The connection has been configured in source; APK compilation and device verification are still required.

Application ID: com.wifipalace.saloncloud. This installs alongside the original offline application so it does not delete or replace old data. The existing Java namespace remains com.wifipalace.salonpos.

The shell loads only the configured HTTPS origin and blocks external top-level navigation. It exposes native logo selection, file export and system printing to the hosted application. Keep hosting restricted to trusted application code. Browsing arbitrary websites with this bridge is not supported.

First use requires connectivity and a provisioned salon account. Offline use relies on the cached hosted app shell, a current Android System WebView and its service worker/Web Locks support. Validate airplane-mode billing, close/reopen, reconnect, duplicate prevention, cookie persistence, logo selection and receipt export on the real POS machine before rollout.

The native placeholder WP icon is included. No built-in printer SDK, card payment SDK or official company logo is bundled. An owner can upload the company/salon logos through the hosted Settings screen.

## Release build (v2.1)

Create a release key once and keep it safe. Every future update must be signed with the same key.

```
keytool -genkeypair -v -keystore salon-release.jks -alias salondesk -keyalg RSA -keysize 2048 -validity 10000
```

Local build: copy the keystore into `android/`, create `android/keystore.properties` (git-ignored):

```
storeFile=salon-release.jks
storePassword=...
keyAlias=salondesk
keyPassword=...
```

Then run `gradle :app:assembleRelease` (APK) or `gradle :app:bundleRelease` (AAB for Google Play).

GitHub build: `.github/workflows/android.yml` builds a debug APK on every push to `android/`. To also get a signed release APK/AAB, add repository secrets `SALON_KEYSTORE_BASE64` (output of `base64 -w0 salon-release.jks`), `SALON_KEYSTORE_PASSWORD`, `SALON_KEY_ALIAS`, `SALON_KEY_PASSWORD`. Download the result from the workflow run's **Artifacts**.

Shell behaviour in v2.1: WhatsApp, phone, email and other outside links open in the matching app; Back goes to the previous page before asking to close; a "No connection · Retry" screen replaces the browser error page; native bridge calls only work while the trusted salon page is loaded; `<input type="file">` opens the file picker; content is padded for Android 15 edge-to-edge display.

## LAN receipt printers (WiFi Palace POS 3.0)

App ID `com.wifipalace.pos` (installs alongside Salon Desk). Loads https://pos.wifipalace.in/.

Receipts print straight to network thermal printers (ESC/POS over TCP port 9100, e.g. POSWAY CPQ 2 / CPQ 3). Each device stores its printer IP and paper width (80 or 58 mm) under Settings → Receipt printer. The receipt is rendered as an image, so Arabic text and the business logo print on any ESC/POS printer. Only private shop-network addresses (10.x, 172.16–31.x, 192.168.x) on port 9100 are allowed. Without a printer set, the Android print dialog is used.

Printer setup: print the printer's self-test page (hold FEED while switching on) to find its IP; give it a fixed IP or a DHCP reservation on the shop router.
