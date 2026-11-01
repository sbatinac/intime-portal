package hr.intime.panther;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Pokreni Panther kad se TV upali. */
public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
        try {
            Intent a = new Intent(c, MainActivity.class);
            a.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(a);
        } catch (Exception e) { /* neki TV-i ne dopuštaju — onda se pali ručno */ }
    }
}
