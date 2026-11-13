package dev.hive.mobile

// Notifications from Orbit: pushed through Firebase when the app is closed (data only, still sealed: the app opens the
// blob and shows it, so Google never sees the text), or straight over the socket while it is open. A question's
// choices and Stop ride along as buttons, which work while the app is locked (NoteAction).
import android.app.Application
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject
import java.time.LocalTime

class HiveApp : Application() {
    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(Notes.CHANNEL, "Claude", NotificationManager.IMPORTANCE_HIGH).apply { description = "Messages from Claude in Orbit" })
        // the same messages during quiet hours: shown, without sound or a pop-up
        nm.createNotificationChannel(NotificationChannel(Notes.QUIET, "Claude, quiet hours", NotificationManager.IMPORTANCE_LOW).apply { description = "What arrives during quiet hours" })
    }
}

object Notes {
    const val CHANNEL = "claude"
    const val QUIET = "claude-quiet"
    private const val LATE_MS = 10 * 60_000L

    fun idOf(seq: Long): Int = (seq % Int.MAX_VALUE).toInt()

    // pane: a screen to open instead of a thread ("usage", from the usage guard)
    private fun openApp(ctx: Context, thread: String, code: Int, pane: String = ""): PendingIntent {
        val open = Intent(ctx, MainActivity::class.java).putExtra("thread", thread).putExtra("pane", pane).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(ctx, code, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun base(ctx: Context, channel: String): Notification.Builder = Notification.Builder(ctx, channel).setSmallIcon(R.drawable.ic_orbit).setAutoCancel(true)
        // on the lock screen only "Claude sent you something"; the text and the buttons show once the phone is unlocked
        .setVisibility(Notification.VISIBILITY_PRIVATE)
        .setPublicVersion(Notification.Builder(ctx, channel).setSmallIcon(R.drawable.ic_orbit).setContentTitle("Orbit").setContentText("Claude sent you something").build())

    fun show(ctx: Context, m: JSONObject) {
        val thread = m.optString("thread")
        // the thread on screen right now: the message is already in front of the user
        if (Relay.visible && thread.isNotEmpty() && thread == Relay.viewing) return
        val id = idOf(m.optLong("seq"))
        val now = LocalTime.now()
        val channel = if (QuietHours.silent(Settings.quiet(ctx), m.optString("kind"), now.hour * 60 + now.minute)) QUIET else CHANNEL
        val n = base(ctx, channel)
            .setContentTitle(m.optString("title").ifEmpty { "Orbit" })
            .setContentText(m.optString("body"))
            .setStyle(Notification.BigTextStyle().bigText(m.optString("body")))
            .setContentIntent(openApp(ctx, thread, (thread + m.optString("open")).hashCode(), m.optString("open")))
        // Orbit stamps each one with its clock. The time shown is when Orbit sent it, and one that took more than ten
        // minutes to arrive (the phone was off, or the relay held it back) says so: it may no longer be true.
        val at = m.optLong("at")
        val late = at > 0 && System.currentTimeMillis() - at > LATE_MS
        if (at > 0) n.setWhen(at).setShowWhen(true)
        if (late) n.setSubText("Arrived late")
        // No buttons on a late one: the question may be answered or the thread long done.
        if (!late) NoteButtons.of(m, Settings.buttons(ctx)).forEachIndexed { i, b ->
            val press = if (b.op == "open") openApp(ctx, thread, thread.hashCode() + 1 + i) else PendingIntent.getBroadcast(
                ctx, id * 4 + i,
                Intent(ctx, NoteAction::class.java).putExtra("note", id).putExtra("thread", thread).putExtra("op", b.op).putExtra("ask", b.ask).putExtra("label", b.label).putExtra("title", m.optString("title")),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val a = Notification.Action.Builder(null, b.label, press)
            // the phone itself must be unlocked before a button does anything
            if (Build.VERSION.SDK_INT >= 31) a.setAuthenticationRequired(true)
            n.addAction(a.build())
        }
        ctx.getSystemService(NotificationManager::class.java).notify(id, n.build())
    }

    // what became of a pressed button, in place of the notification it was on (quietly: the user is looking at it)
    fun result(ctx: Context, id: Int, thread: String, title: String, text: String) {
        val n = base(ctx, QUIET).setContentTitle(title.ifEmpty { "Orbit" }).setContentText(text).setContentIntent(openApp(ctx, thread, thread.hashCode())).setTimeoutAfter(60_000)
        ctx.getSystemService(NotificationManager::class.java).notify(id, n.build())
    }
}

// A notification's button was pressed (a question's choice, or Stop). The app may be locked or not running, so this
// uses only what is readable without the fingerprint: the relay address and token and the notification key. Orbit
// takes such a request for exactly two things, stopping a thread and a choice that holds back, and checks both itself.
class NoteAction : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val app = ctx.applicationContext
        val id = intent.getIntExtra("note", 0)
        val thread = intent.getStringExtra("thread") ?: return
        val b = NoteButton(intent.getStringExtra("label") ?: "", intent.getStringExtra("op") ?: return, intent.getStringExtra("ask") ?: "")
        val title = intent.getStringExtra("title") ?: ""
        val pending = goAsync()
        Thread {
            try {
                val k = Vault.known(app)
                val took = if (k == null) null else Relay.post(k, NoteButtons.request(b, thread, Vault.nextSeq(app)))
                val what = if (b.op == "stop") "Stop" else "\"${b.label}\""
                Notes.result(app, id, thread, title, when (took) {
                    true -> if (b.op == "stop") "Stop sent to the computer." else "Answered: ${b.label}"
                    false -> "$what was not sent: the computer is offline. Open Orbit to try again."
                    null -> "$what was not sent: the relay could not be reached. Open Orbit to try again."
                })
            } finally { pending.finish() }
        }.start()
    }
}

class Push : FirebaseMessagingService() {
    override fun onNewToken(token: String) = Relay.registerPush(this, token)

    override fun onMessageReceived(msg: RemoteMessage) {
        // only sealed notifications are shown: a push without one is not from Orbit (Orbit keeps every notification small
        // enough to ride in the push), so neither the relay nor anyone with the push token can make the phone show anything
        val blob = msg.data["blob"] ?: return
        if (blob.length > 8192) return
        val k = Vault.known(this) ?: return
        // with the notification key, which the app can use while locked; an Orbit from before that key seals
        // notifications with the pairing key, which is only at hand while the app is unlocked
        val m = Seal.open(k.notifyKey, k.pair, "d2n", blob)
            ?: Vault.session?.let { Seal.open(it.key, it.pair, "d2p", blob) }
            ?: return
        if (!Vault.takeSeq(this, m.optLong("seq"))) return
        if (m.optString("op") == "notify") Notes.show(this, m)
    }
}
