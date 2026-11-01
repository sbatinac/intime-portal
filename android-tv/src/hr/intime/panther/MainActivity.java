package hr.intime.panther;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.CookieManager;

/** Panther TV — otvara In Time „Command Bridge” preko cijelog ekrana. */
public class MainActivity extends Activity {
    static final String URL = "https://sbatinac.github.io/intime-portal/InTime_TV.html";
    private WebView web;
    private final Handler h = new Handler(Looper.getMainLooper());
    private long zadnjiBack = 0;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        web = new WebView(this);
        setContentView(web);
        sakrijTrake();
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " PantherTV/1.0");
        CookieManager.getInstance().setAcceptCookie(true);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req != null && req.isForMainFrame()) {
                    v.loadData("<html><body style='background:#050b1f;color:#9fd2ff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-size:4vh;text-align:center'>⚓ Nema interneta — Panther se ponovno spaja za 30 s…</body></html>", "text/html; charset=utf-8", "UTF-8");
                    h.postDelayed(new Runnable() { public void run() { web.loadUrl(URL); } }, 30000);
                }
            }
        });
        if (b != null) { web.restoreState(b); } else { web.loadUrl(URL); }
    }

    private void sakrijTrake() {
        web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @Override public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) { sakrijTrake(); } }
    @Override protected void onSaveInstanceState(Bundle o) { super.onSaveInstanceState(o); web.saveState(o); }
    @Override protected void onResume() { super.onResume(); web.onResume(); }
    @Override protected void onPause() { web.onPause(); super.onPause(); }

    @Override public boolean onKeyDown(int code, KeyEvent e) {
        if (code == KeyEvent.KEYCODE_BACK) {
            if (web.canGoBack()) { web.goBack(); return true; }
            long sad = System.currentTimeMillis();
            if (sad - zadnjiBack < 2500) { finish(); return true; }
            zadnjiBack = sad;
            android.widget.Toast.makeText(this, "Pritisni NAZAD još jednom za izlaz", android.widget.Toast.LENGTH_SHORT).show();
            return true;
        }
        if (code == KeyEvent.KEYCODE_MENU || code == KeyEvent.KEYCODE_PROG_RED) { web.reload(); return true; }
        return super.onKeyDown(code, e);
    }
}
