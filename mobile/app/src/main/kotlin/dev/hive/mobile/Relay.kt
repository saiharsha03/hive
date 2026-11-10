package dev.hive.mobile

// The connection to Hive through the relay, owned here and nowhere else: one WebSocket while the app is on screen and
// unlocked (start / stop, called by the activity), reconnecting by itself with a growing wait, requests matched to
// replies by rid, and the computer's online state. Notifications that arrive here are shown like pushed ones.
//
// The relay is not trusted: "online" is only believed once Hive itself has answered (a sealed reply), a frame too
// long to be Hive's is never parsed, and a refused sign-in (401, or the relay's 4401 close) means this phone is no
// longer paired, which the screens say instead of trying again forever.
import android.content.Context
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

// what a request to Hive failed with, in words for the screen
class RelayError(message: String) : Exception(message)

// work that must finish even when the screen that started it is gone (a send, so a failed one can put the text back)
val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

object Relay {
    // Connecting = no answer from Hive yet; RelayOnly = the relay answers but Hive (the computer) is not connected;
    // Unpaired = the relay refused this phone's token
    enum class State { Off, Connecting, RelayOnly, Online, Unpaired }

    val state = MutableStateFlow(State.Off)
    val changed = MutableStateFlow(0) // bumped when Hive sends anything unasked, so open screens refresh
    val skew = MutableStateFlow(0L) // the computer's clock minus the phone's, in ms, from Hive's last message
    val trouble = MutableStateFlow("") // something the user has to fix (the pairing no longer matches)

    // the thread on screen, and whether the app is: no notification for what the user is looking at
    @Volatile var viewing: String? = null
    @Volatile var visible = false

    private const val MAX_FRAME = 4 * 1024 * 1024 // the relay passes at most 2 MB
    private val http = OkHttpClient.Builder().pingInterval(25, TimeUnit.SECONDS).build()
    private val main = android.os.Handler(android.os.Looper.getMainLooper())
    private val pushes = Executors.newSingleThreadExecutor()

    @Volatile private var app: Context? = null
    // everything below is touched on the main thread only (the socket's callbacks post to it)
    private var ws: WebSocket? = null
    private var wanted = false
    private var fails = 0
    private var retry: Runnable? = null
    private var greeting: Job? = null
    private var unopened = 0
    // requests waiting for their reply, by rid = the request's seq (unique across app restarts, so a reply the relay
    // held back can never answer a later request)
    private val waiting = ConcurrentHashMap<Long, CompletableDeferred<JSONObject>>()

    // the app came on screen unlocked (or was just paired): connect and stay connected
    fun start(context: Context) {
        app = context.applicationContext
        wanted = true
        fails = 0
        if (state.value == State.Unpaired) state.value = State.Off
        if (ws != null) return // already connected (or on its way)
        connect()
        registerPush(context)
    }

    // the app left the screen, was locked or unpaired
    fun stop() {
        wanted = false
        retry?.let { main.removeCallbacks(it) }
        retry = null
        greeting?.cancel()
        ws?.close(1000, "bye")
        ws = null
        if (state.value != State.Unpaired) state.value = State.Off
        failWaiting("The connection was closed")
    }

    private fun failWaiting(why: String) {
        waiting.values.forEach { it.completeExceptionally(RelayError(why)) }
        waiting.clear()
    }

    private fun connect() {
        retry?.let { main.removeCallbacks(it) }
        retry = null
        val p = Vault.session ?: return
        if (!wanted || ws != null) return
        state.value = State.Connecting
        val req = Request.Builder().url("${p.ws}/v1/ws?pair=${p.pair}&role=phone").header("Authorization", "Bearer ${p.token}").build()
        ws = http.newWebSocket(req, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                if (text.length > MAX_FRAME) { webSocket.close(1009, "too long"); return }
                val f = read(p, text) ?: return // opened here, off the main thread
                main.post { if (ws === webSocket) onFrame(f) }
            }
            // the relay closes first (replaced by a newer connection, unpaired): answer, or the socket lingers half open
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
                main.post { dropped(webSocket, code == 4401) }
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { main.post { dropped(webSocket, code == 4401) } }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { main.post { dropped(webSocket, response?.code == 401) } }
        })
    }

    private fun dropped(s: WebSocket, refused: Boolean) {
        if (ws !== s) return
        ws = null
        greeting?.cancel()
        failWaiting("The connection was lost")
        if (refused) { state.value = State.Unpaired; return } // trying again would be refused again
        state.value = State.Off
        if (!wanted) return
        // 1, 2, 4 ... 60 s; back to 1 s once Hive has answered or the app comes on screen again
        val wait = minOf(60_000L, 1000L shl minOf(fails, 6))
        fails += 1
        retry = Runnable { connect() }.also { main.postDelayed(it, wait) }
    }

    private class Frame(val desk: String, val sealed: Boolean, val msg: JSONObject?)

    // one frame from the relay: its word on the computer, and Hive's message if there is a new one that opens
    private fun read(p: Pairing, text: String): Frame? {
        val f = runCatching { JSONObject(text) }.getOrNull() ?: return null
        val blob = f.optString("blob")
        if (blob.isEmpty()) return Frame(f.optString("desk"), false, null)
        val c = app ?: return null
        // the notification key opens notifications and nothing else: never a reply to a request
        val m = Seal.open(p.key, p.pair, "d2p", blob)
            ?: Seal.open(p.notifyKey, p.pair, "d2n", blob)?.takeIf { it.optString("op") == "notify" && !it.has("re") }
        if (m != null && !Vault.takeSeq(c, m.optLong("seq"))) return null // a repeat
        return Frame("", true, m)
    }

    private fun onFrame(f: Frame) {
        if (f.desk == "offline") state.value = State.RelayOnly
        // the relay's word alone is not enough for "online": ask Hive, and believe its sealed answer
        else if (f.desk == "online" && state.value != State.Online) { state.value = State.Connecting; greet() }
        if (!f.sealed) return
        val m = f.msg
        if (m == null) {
            // not sealed for this pairing: after a few in a row with nothing good in between, the pairing is not Hive's
            unopened += 1
            if (unopened >= 3) trouble.value = "Hive's messages cannot be opened on this phone. Unpair it and pair again."
            return
        }
        unopened = 0
        trouble.value = ""
        fails = 0
        m.optLong("at").takeIf { it > 0 }?.let { skew.value = it - System.currentTimeMillis() }
        state.value = State.Online
        if (m.has("re")) { waiting.remove(m.optLong("re"))?.complete(m); return }
        if (m.optString("op") == "notify") app?.let { Notes.show(it, m) }
        changed.value += 1
    }

    // hello until Hive answers. v 2: this app opens notifications with the notification key. An older Hive answers
    // "unknown request", which is still its own sealed answer.
    private fun greet() {
        if (greeting?.isActive == true) return
        val s = ws
        greeting = appScope.launch {
            while (ws === s && state.value != State.Online && state.value != State.RelayOnly) {
                runCatching { ask("hello", mapOf("v" to 2)) }
                if (state.value != State.Online) delay(5_000)
            }
        }
    }

    // one request to Hive and its reply; throws RelayError (in words for the screen) when the computer is offline,
    // does not answer or refuses
    suspend fun ask(op: String, extra: Map<String, Any> = emptyMap()): JSONObject = withContext(Dispatchers.Main.immediate) {
        val c = app ?: throw RelayError("Not paired")
        val p = Vault.session ?: throw RelayError("Hive is locked")
        val s = ws ?: throw RelayError("Not connected")
        val id = Vault.nextSeq(c)
        val msg = JSONObject(extra).put("op", op).put("rid", id).put("seq", id)
        val d = CompletableDeferred<JSONObject>()
        waiting[id] = d
        val r = try {
            if (!s.send(JSONObject().put("blob", Seal.seal(p.key, p.pair, "p2d", msg)).toString())) throw RelayError("Not connected")
            withTimeout(20_000) { d.await() }
        } catch (e: TimeoutCancellationException) {
            throw RelayError("The computer did not answer. Check that Hive is open there, then try again.")
        } finally { waiting.remove(id) }
        r.optString("error").takeIf { it.isNotEmpty() }?.let { throw RelayError(it) }
        r
    }

    // "Unpair this phone": Hive is told (it drops the pairing there and on the relay), then the phone forgets it.
    // False when Hive could not be told (offline, or an older Hive): the user has to unpair on the computer too.
    suspend fun unpair(context: Context): Boolean {
        val told = state.value == State.Online && runCatching { ask("unpair") }.isSuccess
        stop()
        state.value = State.Off
        trouble.value = ""
        Vault.clear(context.applicationContext)
        return told
    }

    // Tell the relay where to push notifications for this phone (Firebase token); the relay never sees what is in
    // them. Tried again with a growing wait until the relay has it (it forgets the token when Firebase refuses one).
    fun registerPush(context: Context, fcm: String? = null) {
        val c = context.applicationContext
        val k = Vault.known(c) ?: return
        if (fcm == null) { FirebaseMessaging.getInstance().token.addOnSuccessListener { registerPush(c, it) }; return }
        val body = JSONObject().put("pair", k.pair).put("fcm", fcm).toString()
        pushes.execute {
            var wait = 2_000L
            for (i in 0 until 5) {
                val req = Request.Builder().url("${k.relay}/v1/fcm").header("Authorization", "Bearer ${k.token}").post(body.toRequestBody("application/json".toMediaType())).build()
                // done when the relay took it, or refused this phone (no longer paired: asking again changes nothing)
                val done = runCatching { http.newCall(req).execute().use { it.isSuccessful || it.code == 401 } }.getOrDefault(false)
                if (done || Vault.known(c)?.pair != k.pair) return@execute
                Thread.sleep(wait)
                wait *= 4
            }
        }
    }
}
