package com.wifipalace.salonpos;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;

/**
 * Prints to network thermal receipt printers (ESC/POS, raw TCP port 9100), e.g. POSWAY CPQ 2 / CPQ 3.
 *
 * The receipt is drawn as a picture and sent as raster graphics, so Arabic, any font and the
 * business logo print the same on every ESC/POS printer without code-page setup.
 */
final class EscPosPrinter {
    static final int PORT = 9100;
    private static final int TIMEOUT_MS = 5000;

    private EscPosPrinter() {}

    /** Only printers on the shop's own network may be reached: private IPv4 addresses, port 9100. */
    static InetAddress checkPrinterAddress(String host) throws IOException {
        if (host == null || !host.matches("^\\d{1,3}(\\.\\d{1,3}){3}$")) throw new IOException("Enter the printer's IP address, e.g. 192.168.1.50");
        String[] p = host.split("\\.");
        int a = Integer.parseInt(p[0]), b = Integer.parseInt(p[1]);
        for (String part : p) if (Integer.parseInt(part) > 255) throw new IOException("Invalid printer IP address");
        boolean privateNet = a == 10 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168);
        if (!privateNet) throw new IOException("The printer must be on the shop network (10.x, 172.16–31.x or 192.168.x)");
        return InetAddress.getByName(host); // numeric: no DNS lookup
    }

    /** paperMm: 80 (576 dots) or 58 (384 dots) at 203 dpi. */
    static void print(String host, int paperMm, String text, Bitmap logo, boolean cut) throws IOException {
        InetAddress address = checkPrinterAddress(host);
        int width = paperMm == 58 ? 384 : 576;
        Bitmap page = render(width, text == null ? "" : text, logo);
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(address, PORT), TIMEOUT_MS);
            socket.setSoTimeout(TIMEOUT_MS);
            OutputStream out = socket.getOutputStream();
            out.write(new byte[]{0x1B, 0x40});                // ESC @  initialise
            writeRaster(out, page);
            out.write(new byte[]{0x1B, 0x64, 0x04});          // ESC d 4  feed 4 lines
            if (cut) out.write(new byte[]{0x1D, 0x56, 0x42, 0x00}); // GS V 66 0  partial cut
            out.flush();
        } finally {
            page.recycle();
        }
    }

    /** Draws logo (centred) and receipt text; monospace so columns line up, with Android's Arabic fallback fonts. */
    static Bitmap render(int width, String text, Bitmap logo) {
        int margin = 8, textWidth = width - margin * 2;
        TextPaint paint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(Color.BLACK);
        paint.setTypeface(Typeface.create(Typeface.MONOSPACE, Typeface.BOLD));
        // Size the font so a 32-character receipt line fills the paper width.
        paint.setTextSize(100f);
        float perChar = paint.measureText("0") / 100f;
        paint.setTextSize(Math.max(14f, textWidth / (32f * perChar)));
        StaticLayout layout = StaticLayout.Builder.obtain(text, 0, text.length(), paint, textWidth)
            .setAlignment(Layout.Alignment.ALIGN_NORMAL).setLineSpacing(2f, 1f).setIncludePad(false).build();
        int logoH = 0, logoW = 0;
        if (logo != null) {
            logoW = Math.min(logo.getWidth(), (int) (width * 0.6f));
            logoH = Math.round(logo.getHeight() * (logoW / (float) logo.getWidth()));
            logoH = Math.min(logoH, 200);
            logoW = Math.round(logo.getWidth() * (logoH / (float) logo.getHeight()));
        }
        int height = margin + (logoH > 0 ? logoH + 16 : 0) + layout.getHeight() + margin;
        Bitmap page = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(page);
        canvas.drawColor(Color.WHITE);
        int y = margin;
        if (logo != null && logoH > 0) {
            Bitmap scaled = Bitmap.createScaledBitmap(logo, logoW, logoH, true);
            canvas.drawBitmap(scaled, (width - logoW) / 2f, y, null);
            if (scaled != logo) scaled.recycle();
            y += logoH + 16;
        }
        canvas.save();
        canvas.translate(margin, y);
        layout.draw(canvas);
        canvas.restore();
        return page;
    }

    /** GS v 0 raster image, sent in bands so small printer buffers are not overrun. */
    static void writeRaster(OutputStream out, Bitmap page) throws IOException {
        int width = page.getWidth(), height = page.getHeight(), bytesPerRow = (width + 7) / 8, band = 128;
        int[] pixels = new int[width];
        for (int top = 0; top < height; top += band) {
            int rows = Math.min(band, height - top);
            ByteArrayOutputStream buf = new ByteArrayOutputStream(8 + bytesPerRow * rows);
            buf.write(new byte[]{0x1D, 0x76, 0x30, 0x00,
                (byte) (bytesPerRow & 0xFF), (byte) ((bytesPerRow >> 8) & 0xFF),
                (byte) (rows & 0xFF), (byte) ((rows >> 8) & 0xFF)});
            for (int r = 0; r < rows; r++) {
                page.getPixels(pixels, 0, width, 0, top + r, width, 1);
                for (int bx = 0; bx < bytesPerRow; bx++) {
                    int value = 0;
                    for (int bit = 0; bit < 8; bit++) {
                        int x = bx * 8 + bit;
                        if (x < width) {
                            int c = pixels[x];
                            int alpha = (c >>> 24);
                            int lum = (Color.red(c) * 299 + Color.green(c) * 587 + Color.blue(c) * 114) / 1000;
                            if (alpha > 128 && lum < 140) value |= 0x80 >> bit;
                        }
                    }
                    buf.write(value);
                }
            }
            out.write(buf.toByteArray());
        }
    }

    static Bitmap decodeLogo(String dataUrl) {
        if (dataUrl == null || dataUrl.length() > 1500000 || !dataUrl.matches("^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$")) return null;
        byte[] bytes = android.util.Base64.decode(dataUrl.substring(dataUrl.indexOf(',') + 1), android.util.Base64.DEFAULT);
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
    }
}
