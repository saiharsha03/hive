package dev.hive.mobile

// Notifications from Hive: pushed through Firebase when the app is closed (data only, still sealed: the app opens the
// blob and shows it, so Google never sees the text), or straight over the socket while it is open.
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
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
    private const val LATE_MS = 10 * 60_000L

    fun show(ctx: Context, m: JSONObject) {
        val thread = m.optString("thread")
        // the thread on screen right now: the message is already in front of the user
        if (Relay.visible && thread.isNotEmpty() && thread == Relay.viewing) return
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
        // Hive stamps each one with its clock. The time shown is when Hive sent it, and one that took more than ten
        // minutes to arrive (the phone was off, or the relay held it back) says so: it may no longer be true.
        val at = m.optLong("at")
        if (at > 0) {
            n.setWhen(at).setShowWhen(true)
            if (System.currentTimeMillis() - at > LATE_MS) n.setSubText("Arrived late")
        }
        ctx.getSystemService(NotificationManager::class.java).notify((m.optLong("seq") % Int.MAX_VALUE).toInt(), n.build())
    }
}

class Push : FirebaseMessagingService() {
    override fun onNewToken(token: String) = Relay.registerPush(this, token)

    override fun onMessageReceived(msg: RemoteMessage) {
        // only sealed notifications are shown: a push without one is not from Hive (Hive keeps every notification small
        // enough to ride in the push), so neither the relay nor anyone with the push token can make the phone show anything
        val blob = msg.data["blob"] ?: return
        if (blob.length > 8192) return
        val k = Vault.known(this) ?: return
        // with the notification key, which the app can use while locked; a Hive from before that key seals
        // notifications with the pairing key, which is only at hand while the app is unlocked
        val m = Seal.open(k.notifyKey, k.pair, "d2n", blob)
            ?: Vault.session?.let { Seal.open(it.key, it.pair, "d2p", blob) }
            ?: return
        if (!Vault.takeSeq(this, m.optLong("seq"))) return
        if (m.optString("op") == "notify") Notes.show(this, m)
    }
}
