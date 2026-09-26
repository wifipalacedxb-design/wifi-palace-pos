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
