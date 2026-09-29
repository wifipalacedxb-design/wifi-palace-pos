package com.wifipalace.salonpos;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.*;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

public class MainActivity extends Activity {
    private WebView web, printWeb;
    private String pendingExport;
    private String pendingLogo;
    private ValueCallback<Uri[]> pendingChooser;
    // One print job at a time, off the UI thread.
    private final java.util.concurrent.ExecutorService printQueue = java.util.concurrent.Executors.newSingleThreadExecutor();
    private boolean showingOfflinePage;
    private static final int EXPORT = 101, RESTORE = 102, LOGO = 103, CHOOSER = 104;
    // Live WiFi Palace salon cloud server.
    private static final String HOME = "https://pos.wifipalace.in/";
    // Non-web links the app may hand to other apps (WhatsApp, dialer, mail, maps, SMS).
    private static final String[] EXTERNAL_SCHEMES = {"https", "http", "tel", "mailto", "sms", "smsto", "whatsapp", "geo"};

    private boolean trusted(String url) {
        if (url == null) return false;
        Uri target = Uri.parse(url);
        Uri home = Uri.parse(HOME);
        return "https".equals(target.getScheme()) && home.getHost().equalsIgnoreCase(target.getHost()) && target.getPort() == home.getPort();
    }

    /** Returns true when the URL was handled here (opened outside or blocked), false to let the WebView load it. */
    private boolean handleNavigation(Uri uri) {
        if (trusted(uri.toString())) return false;
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        for (String allowed : EXTERNAL_SCHEMES) {
            if (allowed.equals(scheme)) {
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                    intent.addCategory(Intent.CATEGORY_BROWSABLE);
                    startActivity(intent);
                } catch (ActivityNotFoundException ex) {
                    message(scheme.equals("whatsapp") ? "WhatsApp is not installed on this device." : "No app on this device can open this link.");
                }
                return true;
            }
        }
        return true; // intent:, javascript:, file:, etc. stay blocked
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setAllowFileAccessFromFileURLs(false);
        web.getSettings().setAllowUniversalAccessFromFileURLs(false);
        web.getSettings().setTextZoom(100);
        web.setWebChromeClient(new WebChromeClient() {
            // Makes <input type="file"> work inside the app.
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (!trusted(view.getUrl())) { callback.onReceiveValue(null); return true; }
                if (pendingChooser != null) pendingChooser.onReceiveValue(null);
                pendingChooser = callback;
                try {
                    startActivityForResult(params.createIntent(), CHOOSER);
                } catch (Exception ex) {
                    pendingChooser = null;
                    callback.onReceiveValue(null);
                    message("No file picker available on this device.");
                }
                return true;
            }
        });
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest r) {
                if (!r.isForMainFrame()) return !trusted(r.getUrl().toString());
                return handleNavigation(r.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return handleNavigation(Uri.parse(url)); }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) { showingOfflinePage = !trusted(url); }
            @Override public void onReceivedError(WebView view, WebResourceRequest r, WebResourceError error) {
                if (r.isForMainFrame()) showOffline();
            }
        });
        web.addJavascriptInterface(new Bridge(), "Android");

        // Android 15 draws apps edge-to-edge: pad the content so it is not hidden under the
        // status bar, navigation bar or keyboard.
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#163b30"));
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsets.CONSUMED;
            });
        }
        setContentView(root);
        web.loadUrl(HOME);
    }

    private void showOffline() {
        showingOfflinePage = true;
        String page = "<html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
            + "<body style='margin:0;font-family:sans-serif;background:#f4f7f5;color:#163b30;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center'>"
            + "<div style='padding:24px'><h2>No connection</h2><p>Salon Desk could not reach the server.<br>Check Wi-Fi or mobile data, then try again.</p>"
            + "<a href='" + HOME + "' style='display:inline-block;margin-top:12px;padding:14px 28px;border-radius:10px;background:#176c55;color:#fff;text-decoration:none;font-weight:bold'>Retry</a></div></body></html>";
        web.loadDataWithBaseURL(null, page, "text/html", "UTF-8", null);
    }

    private void printerResult(String id, String error) {
        web.evaluateJavascript("window.onPrinterResult&&window.onPrinterResult(" + JSONObject.quote(id) + "," + (error == null ? "null" : JSONObject.quote(error)) + ")", null);
    }

    private void message(String text) { runOnUiThread(() -> Toast.makeText(this, text, Toast.LENGTH_LONG).show()); }

    /** Bridge calls are only honoured while the main page is the trusted salon server. Must run on the UI thread. */
    private boolean bridgeAllowed() { return !showingOfflinePage && trusted(web.getUrl()); }

    public class Bridge {
        @JavascriptInterface public void exportFile(String name, String text, String mime) {
            runOnUiThread(() -> {
                if (!bridgeAllowed() || text == null) return;
                if (pendingExport != null) { message("Finish the current export first."); return; }
                pendingExport = text;
                try {
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType(mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
                    intent.putExtra(Intent.EXTRA_TITLE, name);
                    startActivityForResult(intent, EXPORT);
                } catch (Exception ex) { pendingExport = null; message("No file picker available on this device."); }
            });
        }
        @JavascriptInterface public void restoreBackup() {
            runOnUiThread(() -> {
                if (!bridgeAllowed()) return;
                try {
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    startActivityForResult(intent, RESTORE);
                } catch (Exception ex) { message("No file picker available on this device."); }
            });
        }
        @JavascriptInterface public void chooseLogo(String kind) {
            if (!"salon".equals(kind) && !"vendor".equals(kind)) return;
            runOnUiThread(() -> {
                if (!bridgeAllowed()) return;
                pendingLogo = kind;
                try {
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("image/*");
                    intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/png", "image/jpeg", "image/webp"});
                    startActivityForResult(intent, LOGO);
                } catch (Exception ex) { pendingLogo = null; message("Image selection is unavailable on this device."); }
            });
        }
        /** Prints straight to a LAN thermal printer. The result comes back via window.onPrinterResult(id, error|null). */
        @JavascriptInterface public void printNetwork(String requestId, String host, int paperMm, String text, String logo, boolean cut) {
            runOnUiThread(() -> {
                if (!bridgeAllowed()) return;
                final String id = requestId == null ? "" : requestId;
                if (text == null || text.length() > 20000) { printerResult(id, "Receipt is too long to print"); return; }
                printQueue.execute(() -> {
                    String error = null;
                    android.graphics.Bitmap logoBitmap = null;
                    try {
                        logoBitmap = EscPosPrinter.decodeLogo(logo);
                        EscPosPrinter.print(host, paperMm, text, logoBitmap, cut);
                    } catch (java.net.SocketTimeoutException | java.net.ConnectException | java.net.NoRouteToHostException ex) {
                        error = "Printer not reachable at " + host + ". Check it is switched on and on the same network.";
                    } catch (Exception ex) {
                        error = ex.getMessage() == null ? "Printing failed" : ex.getMessage();
                    } finally {
                        if (logoBitmap != null) logoBitmap.recycle();
                    }
                    final String err = error;
                    runOnUiThread(() -> printerResult(id, err));
                });
            });
        }
        @JavascriptInterface public void printText(String text) { printReceipt(text, ""); }
        @JavascriptInterface public void printReceipt(String text, String logo) {
            runOnUiThread(() -> {
                if (!bridgeAllowed() || text == null) return;
                printWeb = new WebView(MainActivity.this);
                printWeb.setWebViewClient(new WebViewClient() {
                    private boolean printed;
                    @Override public void onPageFinished(WebView view, String url) {
                        if (printed) return; // onPageFinished can fire more than once; print only once
                        printed = true;
                        try {
                            PrintManager manager = (PrintManager)getSystemService(PRINT_SERVICE);
                            manager.print("Salon receipt", view.createPrintDocumentAdapter("Salon receipt"), new PrintAttributes.Builder().build());
                        } catch (Exception ex) { message("System printing unavailable. Save the receipt as text instead."); }
                    }
                });
                String logoTag = "";
                if (logo != null && logo.length() <= 1500000 && logo.matches("data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+"))
                    logoTag = "<img style='display:block;margin:0 auto 20px;max-width:170px;max-height:85px' src='" + logo + "'>";
                String safe = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
                printWeb.loadDataWithBaseURL(null, "<html><meta charset='utf-8'><body>" + logoTag + "<pre style='white-space:pre-wrap;font:12pt monospace'>" + safe + "</pre><p style='text-align:center;font:9pt sans-serif;color:#777'>Powered by Palace POS</p></body></html>", "text/html", "UTF-8", null);
            });
        }
    }

    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == CHOOSER) {
            if (pendingChooser != null) pendingChooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            pendingChooser = null;
            return;
        }
        if (result != RESULT_OK || data == null || data.getData() == null) { if(code == EXPORT) pendingExport = null; if(code == LOGO) pendingLogo = null; return; }
        try {
            if (code == EXPORT && pendingExport != null) {
                try (OutputStream out = getContentResolver().openOutputStream(data.getData(), "wt")) {
                    if (out == null) throw new IOException("Cannot open file");
                    out.write(pendingExport.getBytes(StandardCharsets.UTF_8));
                }
                pendingExport = null;
                message("File saved");
            } else if (code == LOGO && pendingLogo != null) {
                String kind = pendingLogo; pendingLogo = null;
                try (InputStream in = getContentResolver().openInputStream(data.getData()); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                    if (in == null) throw new IOException("Cannot open logo");
                    byte[] buffer = new byte[8192]; int count;
                    while ((count = in.read(buffer)) != -1) {
                        out.write(buffer, 0, count);
                        if (out.size() > 5 * 1024 * 1024) throw new IOException("Choose a logo smaller than 5 MB");
                    }
                    byte[] bytes = out.toByteArray();
                    android.graphics.BitmapFactory.Options bounds = new android.graphics.BitmapFactory.Options();
                    bounds.inJustDecodeBounds = true;
                    android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
                    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new IOException("Invalid image");
                    android.graphics.BitmapFactory.Options opts = new android.graphics.BitmapFactory.Options();
                    opts.inSampleSize = 1;
                    while (Math.max(bounds.outWidth, bounds.outHeight) / opts.inSampleSize > 1024) opts.inSampleSize *= 2;
                    android.graphics.Bitmap bitmap = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
                    if (bitmap == null) throw new IOException("Cannot decode logo");
                    float scale = Math.min(1f, 512f / Math.max(bitmap.getWidth(), bitmap.getHeight()));
                    android.graphics.Bitmap resized = android.graphics.Bitmap.createScaledBitmap(bitmap, Math.max(1, Math.round(bitmap.getWidth()*scale)), Math.max(1, Math.round(bitmap.getHeight()*scale)), true);
                    ByteArrayOutputStream png = new ByteArrayOutputStream();
                    resized.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, png);
                    String logo = "data:image/png;base64," + android.util.Base64.encodeToString(png.toByteArray(), android.util.Base64.NO_WRAP);
                    if (resized != bitmap) resized.recycle(); bitmap.recycle();
                    web.evaluateJavascript("setLogo(" + JSONObject.quote(kind) + "," + JSONObject.quote(logo) + ")", null);
                }
            } else if (code == RESTORE) {
                try (InputStream in = getContentResolver().openInputStream(data.getData()); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                    if (in == null) throw new IOException("Cannot open backup");
                    byte[] buffer = new byte[8192]; int count;
                    while ((count = in.read(buffer)) != -1) {
                        out.write(buffer, 0, count);
                        if (out.size() > 20 * 1024 * 1024) throw new IOException("Backup exceeds 20 MB");
                    }
                    String raw = new String(out.toByteArray(), StandardCharsets.UTF_8);
                    web.evaluateJavascript("restoreData(" + JSONObject.quote(raw) + ")", null);
                }
            }
        } catch (Exception ex) { pendingExport = null; message("File operation failed: " + ex.getMessage()); }
    }

    @Override protected void onDestroy() { printQueue.shutdown(); super.onDestroy(); }

    @Override public void onBackPressed() {
        if (showingOfflinePage) { finish(); return; }
        if (web.canGoBack()) { web.goBack(); return; }
        new AlertDialog.Builder(this).setTitle("Close Palace POS?").setMessage("Saved and queued sales stay on this device. An unpaid bill will be cleared.")
            .setNegativeButton("Stay", null).setPositiveButton("Close", (d,w) -> finish()).show();
    }
}
