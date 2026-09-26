package com.wifipalace.salonpos;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.webkit.*;
import android.widget.Toast;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

public class MainActivity extends Activity {
    private WebView web, printWeb;
    private String pendingExport;
    private String pendingLogo;
    private static final int EXPORT = 101, RESTORE = 102, LOGO = 103;
    // Live WiFi Palace salon cloud server.
    private static final String HOME = "https://wifipalace.in/";
    private boolean trusted(String url) {
        android.net.Uri target = android.net.Uri.parse(url);
        android.net.Uri home = android.net.Uri.parse(HOME);
        return "https".equals(target.getScheme()) && home.getHost().equals(target.getHost()) && target.getPort() == home.getPort();
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
        web.setWebChromeClient(new WebChromeClient());
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest r) { return !trusted(r.getUrl().toString()); }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return !trusted(url); }
        });
        web.addJavascriptInterface(new Bridge(), "Android");
        setContentView(web);
        web.loadUrl(HOME);
    }
    private void message(String text) { runOnUiThread(() -> Toast.makeText(this, text, Toast.LENGTH_LONG).show()); }
    public class Bridge {
        @JavascriptInterface public void exportFile(String name, String text, String mime) {
            runOnUiThread(() -> {
                if (pendingExport != null) { message("Finish the current export first."); return; }
                pendingExport = text;
                try {
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType(mime);
                    intent.putExtra(Intent.EXTRA_TITLE, name);
                    startActivityForResult(intent, EXPORT);
                } catch (Exception ex) { pendingExport = null; message("No file picker available on this device."); }
            });
        }
        @JavascriptInterface public void restoreBackup() {
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    startActivityForResult(intent, RESTORE);
                } catch (Exception ex) { message("No file picker available on this device."); }
            });
        }
        @JavascriptInterface public void chooseLogo(String kind) {
            if (!kind.equals("salon") && !kind.equals("vendor")) return;
            runOnUiThread(() -> {
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
        @JavascriptInterface public void printText(String text) { printReceipt(text, ""); }
        @JavascriptInterface public void printReceipt(String text, String logo) {
            runOnUiThread(() -> {
                printWeb = new WebView(MainActivity.this);
                printWeb.setWebViewClient(new WebViewClient() {
                    @Override public void onPageFinished(WebView view, String url) {
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
                printWeb.loadDataWithBaseURL(null, "<html><meta charset='utf-8'><body>" + logoTag + "<pre style='white-space:pre-wrap;font:12pt monospace'>" + safe + "</pre><p style='text-align:center;font:9pt sans-serif;color:#777'>Powered by WiFi Palace · Salon Desk</p></body></html>", "text/html", "UTF-8", null);
            });
        }
    }
    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
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
    @Override public void onBackPressed() {
        new AlertDialog.Builder(this).setTitle("Close Salon Desk?").setMessage("Saved and queued sales stay on this device. An unpaid bill will be cleared.")
            .setNegativeButton("Stay", null).setPositiveButton("Close", (d,w) -> finish()).show();
    }
}
