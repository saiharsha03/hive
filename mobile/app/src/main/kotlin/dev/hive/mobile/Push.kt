package dev.hive.mobile

// Notifications from Hive: pushed through Firebase when the app is closed (data only, still sealed: the app opens the
// blob and shows it, so Google never sees the text), or straight over the socket while it is open.
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject

class HiveApp : Application() {
    override fun onCreate() {
        super.onCreate()
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(Notes.CHANNEL, "Claude", NotificationManager.IMPORTANCE_HIGH).apply { description = "Messages from Claude in Hive" },
        )
    }
}

object Notes {
    const val CHANNEL = "claude"

    fun show(ctx: Context, m: JSONObject) {
        val thread = m.optString("thread")
        val open = Intent(ctx, MainActivity::class.java).putExtra("thread", thread).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val tap = PendingIntent.getActivity(ctx, thread.hashCode(), open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = android.app.Notification.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_hive)
            .setContentTitle(m.optString("title").ifEmpty { "Hive" })
            .setContentText(m.optString("body"))
            .setStyle(android.app.Notification.BigTextStyle().bigText(m.optString("body")))
            .setContentIntent(tap)
            .setAutoCancel(true)
            // on the lock screen only "Claude sent you something"; the text shows once the phone is unlocked
            .setVisibility(android.app.Notification.VISIBILITY_PRIVATE)
            .setPublicVersion(android.app.Notification.Builder(ctx, CHANNEL).setSmallIcon(R.drawable.ic_hive).setContentTitle("Hive").setContentText("Claude sent you something").build())
            .build()
        ctx.getSystemService(NotificationManager::class.java).notify((m.optLong("seq") % Int.MAX_VALUE).toInt(), n)
    }

    fun registerPush(ctx: Context) {
        FirebaseMessaging.getInstance().token.addOnSuccessListener { Relay.registerPush(ctx, it) }
    }
}

class Push : FirebaseMessagingService() {
    override fun onNewToken(token: String) = Relay.registerPush(this, token)

    override fun onMessageReceived(msg: RemoteMessage) {
        val p = Pairing.load(this) ?: return
        val blob = msg.data["blob"]
        if (blob == null) { // too big to ride in the push: just say there is something
            Notes.show(this, JSONObject().put("title", "Hive").put("body", "Claude sent you something; open Hive to see it").put("seq", System.currentTimeMillis()))
            return
        }
        val m = Seal.open(p.key, p.pair, "d2p", blob) ?: return
        if (!Pairing.takeSeq(this, m.optLong("seq"))) return
        if (m.optString("op") == "notify") Notes.show(this, m)
    }
}
