package dev.hive.mobile

// The connection to Hive through the relay while the app is open: one WebSocket, requests matched to replies by rid,
// and the computer's online state. Notifications that arrive here are shown like pushed ones.
import android.content.Context
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
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
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

object Relay {
    enum class State { Off, Connecting, RelayOnly, Online }

    val state = MutableStateFlow(State.Off) // RelayOnly = the relay answers but Hive (the computer) is not connected
    val changed = MutableStateFlow(0) // bumped when Hive sends anything unasked, so open screens refresh

    private val http = OkHttpClient.Builder().pingInterval(25, TimeUnit.SECONDS).build()
    private var ws: WebSocket? = null
    private var ctx: Context? = null
    private val waiting = ConcurrentHashMap<Int, CompletableDeferred<JSONObject>>()
    private val rid = AtomicInteger(0)

    // at most one attempt every 5 s: with no network a failed attempt comes back at once, and the screens ask again
    private val main = android.os.Handler(android.os.Looper.getMainLooper())
    private var lastTry = 0L
    private var later = false

    fun connect(context: Context) {
        val p = Pairing.load(context) ?: return
        ctx = context.applicationContext
        if (ws != null) return
        val wait = lastTry + 5_000 - android.os.SystemClock.elapsedRealtime()
        if (wait > 0) {
            if (!later) { later = true; main.postDelayed({ later = false; connect(context) }, wait) }
            return
        }
        lastTry = android.os.SystemClock.elapsedRealtime()
        state.value = State.Connecting
        val req = Request.Builder().url("${p.ws}/v1/ws?pair=${p.pair}&role=phone").header("Authorization", "Bearer ${p.token}").build()
        ws = http.newWebSocket(req, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) = onFrame(p, text)
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = dropped(webSocket)
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = dropped(webSocket)
        })
    }

    fun disconnect() { ws?.close(1000, "bye"); ws = null; state.value = State.Off }

    private fun dropped(s: WebSocket) {
        if (ws !== s) return
        ws = null
        state.value = State.Off
        waiting.values.forEach { it.completeExceptionally(IllegalStateException("Connection lost")) }
        waiting.clear()
    }

    private fun onFrame(p: Pairing, text: String) {
        val f = runCatching { JSONObject(text) }.getOrNull() ?: return
        f.optString("desk").takeIf { it.isNotEmpty() }?.let { state.value = if (it == "online") State.Online else State.RelayOnly }
        val blob = f.optString("blob").takeIf { it.isNotEmpty() } ?: return
        val c = ctx ?: return
        val m = Seal.open(p.key, p.pair, "d2p", blob) ?: return
        if (!Pairing.takeSeq(c, m.optLong("seq"))) return
        state.value = State.Online
        if (m.has("re")) { waiting.remove(m.optInt("re"))?.complete(m); return }
        if (m.optString("op") == "notify") Notes.show(c, m)
        changed.value += 1
    }

    // one request to Hive and its reply; throws when the computer is offline or does not answer
    suspend fun ask(op: String, extra: Map<String, Any> = emptyMap()): JSONObject {
        val c = ctx ?: throw IllegalStateException("Not paired")
        val p = Pairing.load(c) ?: throw IllegalStateException("Not paired")
        val s = ws ?: throw IllegalStateException("Not connected")
        val id = rid.incrementAndGet()
        val msg = JSONObject(extra).put("op", op).put("rid", id).put("seq", Pairing.nextSeq())
        val d = CompletableDeferred<JSONObject>()
        waiting[id] = d
        s.send(JSONObject().put("blob", Seal.seal(p.key, p.pair, "p2d", msg)).toString())
        val r = try { withTimeout(20_000) { d.await() } } finally { waiting.remove(id) }
        r.optString("error").takeIf { it.isNotEmpty() }?.let { throw IllegalStateException(it) }
        return r
    }

    // tell the relay where to push notifications for this phone (Firebase token); the relay never sees what is in them
    fun registerPush(context: Context, fcm: String) {
        val p = Pairing.load(context) ?: return
        val body = JSONObject().put("pair", p.pair).put("fcm", fcm).toString().toRequestBody("application/json".toMediaType())
        val req = Request.Builder().url("${p.relay}/v1/fcm").header("Authorization", "Bearer ${p.token}").post(body).build()
        Thread { runCatching { http.newCall(req).execute().close() } }.start()
    }
}
