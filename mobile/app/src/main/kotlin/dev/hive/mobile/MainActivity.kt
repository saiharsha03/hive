package dev.hive.mobile

// The app: a fingerprint to open it, pairing (scan the QR Hive shows, or paste it), then five tabs (Needs me,
// Threads, Running, Scheduled, More) and the screens behind them. This file is the wiring: it asks Hive on the
// computer through the relay (sealed) and hands plain values to the screens in Screens.kt.
import android.Manifest
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.speech.RecognizerIntent
import android.view.WindowManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import javax.crypto.Cipher

private const val LOCK_AFTER_MS = 120_000L

// What was typed and not sent, per thread ("" = the new thread). It lives as long as the app's process, so locking,
// folding the phone, a rotation or leaving the thread does not lose it.
object Drafts {
    val text = mutableStateMapOf<String, String>()
    var newFolder by mutableStateOf("")
    // the last send per thread that has no answer yet: its text and message id. Sending the same text again uses the
    // same id, so Hive runs it once even when the first try did arrive
    val pending = mutableMapOf<String, Pair<String, String>>()

    fun midFor(thread: String, text: String): String =
        pending[thread]?.takeIf { it.first == text }?.second ?: java.util.UUID.randomUUID().toString().also { pending[thread] = text to it }

    fun clear() { text.clear(); pending.clear(); newFolder = "" }
}

class MainActivity : FragmentActivity() {
    private val unlocked = mutableStateOf(false)
    private val lockNote = mutableStateOf("") // why the app did not open
    private val broken = mutableStateOf(false) // the saved pairing cannot be opened any more
    private val openThread = mutableStateOf<String?>(null)
    // a screen a notification asked for instead of a thread (the usage guard opens Usage)
    private val openPane = mutableStateOf("")
    private val main = android.os.Handler(android.os.Looper.getMainLooper())
    // two minutes off the screen: the pairing key leaves memory even if the app is never looked at again
    private val forget = Runnable { if (!Relay.visible) Vault.lock() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // nothing of a thread in the recent-apps picture, a screenshot or a screen recording
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        enableEdgeToEdge()
        openThread.value = intent.getStringExtra("thread")?.takeIf { it.isNotEmpty() }
        openPane.value = intent.getStringExtra("pane") ?: ""
        // the screen was rebuilt (a setting changed) while the app was open and unlocked: no second fingerprint
        unlocked.value = Vault.session != null && !away()
        if (!unlocked.value) Vault.lock()
        setContent {
            HiveTheme {
                Surface(Modifier.fillMaxSize(), color = C.bg) {
                    Box(Modifier.fillMaxSize().systemBarsPadding().imePadding()) {
                        if (!unlocked.value) LockedScreen(lockNote.value, broken.value, onUnlock = { unlock() }, onForget = { forgetPairing() }) else App(openThread, openPane)
                    }
                }
            }
        }
        if (!unlocked.value) unlock()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra("thread")?.takeIf { it.isNotEmpty() }?.let { openThread.value = it }
        intent.getStringExtra("pane")?.takeIf { it.isNotEmpty() }?.let { openPane.value = it }
    }

    private fun away(): Boolean = Vault.hiddenAt > 0 && SystemClock.elapsedRealtime() - Vault.hiddenAt > LOCK_AFTER_MS

    // off the screen: the connection is closed (pushes bring the notifications), and the clock to locking starts
    override fun onStop() {
        super.onStop()
        Relay.visible = false
        Relay.stop()
        Vault.hiddenAt = SystemClock.elapsedRealtime()
        main.removeCallbacks(forget)
        main.postDelayed(forget, LOCK_AFTER_MS)
    }

    override fun onStart() {
        super.onStart()
        main.removeCallbacks(forget)
        Relay.visible = true
        // locked again after two minutes away, or when the key has left memory
        if (unlocked.value && (away() || (Vault.isPaired(this) && Vault.session == null))) { lock(); unlock() }
        Vault.hiddenAt = 0
        if (unlocked.value) Relay.start(this)
    }

    private fun lock() {
        unlocked.value = false
        Vault.lock()
        Relay.stop()
    }

    // After the prompt. cipher: the one the prompt released (Android 11 and up); Android 10 makes it now, which the
    // Keystore allows for 30 s after the check. Until this succeeds the pairing key is not in memory at all.
    private fun opened(cipher: Cipher?) {
        try {
            if (Vault.hasLegacy(this)) Vault.migrate(this)
            else if (Vault.isPaired(this)) Vault.open(this, cipher ?: Vault.unlockCipher())
        } catch (e: KeyPermanentlyInvalidatedException) {
            broken.value = true
            return
        } catch (e: Exception) {
            lockNote.value = "Hive could not open the saved pairing. Try again."
            return
        }
        lockNote.value = ""
        Vault.hiddenAt = 0
        unlocked.value = true
        Relay.start(this)
    }

    private fun forgetPairing() {
        Relay.stop()
        Vault.clear(this)
        Drafts.clear()
        broken.value = false
        unlock()
    }

    // Android 10: the screen lock (PIN, pattern, password) through the system's own confirm screen
    private val screenLock = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        if (r.resultCode == RESULT_OK) opened(null)
    }

    @Suppress("DEPRECATION") // createConfirmDeviceCredentialIntent is the Android 10 way; newer ones use the prompt
    private fun useScreenLock() {
        val km = getSystemService(android.app.KeyguardManager::class.java)
        val ask = km.createConfirmDeviceCredentialIntent("Open Hive", null)
        if (ask == null) lockNote.value = "Set a screen lock (PIN, pattern or password) on this phone to open Hive."
        else screenLock.launch(ask)
    }

    private fun unlock() {
        lockNote.value = ""
        // a paired phone on Android 11 and up: the prompt itself releases the pairing key
        val cipher: Cipher? = if (Vault.isPaired(this) && android.os.Build.VERSION.SDK_INT >= 30) {
            try { Vault.unlockCipher() }
            // the Keystore dropped the key for good (the screen lock was removed), or it is not there
            catch (e: KeyPermanentlyInvalidatedException) { broken.value = true; return }
            catch (e: IllegalStateException) { broken.value = true; return }
            catch (e: Exception) { lockNote.value = "Hive could not reach the phone's key store. Try again."; return }
        } else null
        val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = opened(result.cryptoObject?.cipher)
            // Android 10: no strong fingerprint enrolled, or "Use screen lock" pressed: the screen lock instead
            override fun onAuthenticationError(code: Int, msg: CharSequence) {
                val cancelled = code == BiometricPrompt.ERROR_USER_CANCELED || code == BiometricPrompt.ERROR_CANCELED
                if (android.os.Build.VERSION.SDK_INT < 30 && !cancelled) useScreenLock()
                // anything else that is not the user backing out (no screen lock set, too many tries) is said
                else if (!cancelled && code != BiometricPrompt.ERROR_NEGATIVE_BUTTON) lockNote.value = msg.toString()
            }
        })
        // a strong biometric, with the screen lock as fallback. Android 10 cannot combine the two in one prompt, so
        // there the prompt is the strong biometric alone and its button (or no fingerprint at all) opens the screen lock
        val info = BiometricPrompt.PromptInfo.Builder().setTitle("Open Hive")
        if (android.os.Build.VERSION.SDK_INT >= 30) info.setAllowedAuthenticators(BIOMETRIC_STRONG or DEVICE_CREDENTIAL)
        else info.setAllowedAuthenticators(BIOMETRIC_STRONG).setNegativeButtonText("Use screen lock")
        try {
            if (cipher != null) prompt.authenticate(info.build(), BiometricPrompt.CryptoObject(cipher)) else prompt.authenticate(info.build())
        } catch (e: Exception) {
            // a phone that cannot show this prompt at all: said on the locked screen instead of closing the app
            lockNote.value = "This phone cannot show the unlock prompt (${e.message ?: "unknown reason"})."
        }
    }
}

// One request with its failure in words ("" = it worked). A screen that went away is not a failure: cancellation
// passes through. what: the screen's name, for a Hive on the computer too old to know the request.
private suspend fun attempt(what: String = "", block: suspend () -> Unit): String = try {
    block()
    ""
} catch (e: CancellationException) {
    throw e
} catch (e: RelayError) {
    val m = e.message ?: "Failed"
    if (what.isNotEmpty() && m.contains("unknown request", true)) "Update Hive on the computer to see $what" else m
} catch (e: Exception) {
    "Hive sent something this app does not understand. Update the app or Hive."
}

// A screen's loader: runs when the computer is online, again when Hive sends something unasked or the screen asks
// (the function it returns), and every `every()` ms while that is above zero. One request at a time: a slow answer is
// waited for, never cancelled by the next tick.
@Composable
private fun rememberLoader(vararg keys: Any?, every: () -> Long = { 0L }, load: suspend () -> Unit): () -> Unit {
    val state by Relay.state.collectAsState()
    val online = state == Relay.State.Online
    val poke = remember { Channel<Unit>(Channel.CONFLATED) }
    val currentLoad by rememberUpdatedState(load)
    val currentEvery by rememberUpdatedState(every)
    LaunchedEffect(online, *keys) {
        if (!online) return@LaunchedEffect
        launch { Relay.changed.drop(1).collect { poke.trySend(Unit) } }
        while (true) {
            currentLoad()
            val ms = currentEvery()
            if (ms > 0) withTimeoutOrNull(ms) { poke.receive() } else poke.receive()
        }
    }
    return { poke.trySend(Unit) }
}

// the time now, moving: ages and countdowns on a screen that stays open keep up
@Composable
private fun rememberNow(everyMs: Long = 20_000): Long {
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(everyMs); now = System.currentTimeMillis() } }
    return now
}

// How the link to the computer is, in words, when it is not simply online ("" then): shown under every screen's head.
@Composable
private fun linkNotice(): String {
    val s by Relay.state.collectAsState()
    val trouble by Relay.trouble.collectAsState()
    val skew by Relay.skew.collectAsState()
    val link = when (s) {
        Relay.State.Online -> ""
        Relay.State.RelayOnly -> "The computer is offline (Hive is closed or asleep)."
        Relay.State.Connecting -> "Connecting to the computer."
        Relay.State.Off -> "Not connected. Trying again."
        Relay.State.Unpaired -> "This phone is no longer paired. Unpair it in More, Settings, then pair again in Hive."
    }
    // Hive refuses requests dated more than two minutes off its own clock
    val min = kotlin.math.abs(skew) / 60_000
    val clock = if (kotlin.math.abs(skew) <= 90_000) "" else "This phone's clock is ${if (min < 1) "over a minute" else "$min min"} ${if (skew > 0) "behind" else "ahead of"} the computer's. Hive refuses requests when they differ by more than 2 minutes: set the phone's clock to automatic."
    return listOf(trouble, link, clock).filter { it.isNotEmpty() }.joinToString(" ")
}

// speech to text through the phone's own recogniser: the words land in the text box, nothing is sent
@Composable
private fun rememberMic(onText: (String) -> Unit, onError: (String) -> Unit): () -> Unit {
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        r.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.takeIf { it.isNotBlank() }?.let(onText)
    }
    return {
        try {
            launcher.launch(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM).putExtra(RecognizerIntent.EXTRA_PROMPT, "Say your message"))
        } catch (e: Exception) { onError("This phone has no speech recognition to dictate with.") }
    }
}

private fun joinDraft(old: String, said: String): String = if (old.isBlank()) said else old.trimEnd() + " " + said

@Composable
private fun App(openThread: MutableState<String?>, openPane: MutableState<String>) {
    val ctx = LocalContext.current
    val state by Relay.state.collectAsState()
    val can by Relay.can.collectAsState()
    val online = state == Relay.State.Online
    val notice = linkNotice()
    var paired by remember { mutableStateOf(Vault.session != null) }
    var tab by rememberSaveable { mutableStateOf(0) }
    var pane by rememberSaveable { mutableStateOf("") } // "new", "usage", "teams", "settings", or "" for the open thread
    var pairNote by remember { mutableStateOf("") }
    // a notification that opens a screen: only the ones it may name
    LaunchedEffect(openPane.value) { if (openPane.value == "usage") pane = "usage"; openPane.value = "" }
    // the inbox is loaded here, not in its tab: its counts sit on the tab bar under every screen
    var box by remember { mutableStateOf(Inbox()) }
    var boxLoaded by remember { mutableStateOf(false) }
    var boxError by remember { mutableStateOf("") }
    val reloadBox = rememberLoader(paired, every = { 15_000L }) {
        if (!paired) return@rememberLoader
        boxError = attempt {
            val r = Relay.ask("inbox")
            box = Read.inbox(r)
            boxLoaded = true
        }
        // a Hive from before the inbox: the tabs still work, their counts come from the lists
        if (boxError.contains("unknown request", true)) { boxError = "Update Hive on the computer for the Needs me inbox."; boxLoaded = true }
    }
    // Android 13+ asks before an app may show notifications
    val notifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(Unit) { if (android.os.Build.VERSION.SDK_INT >= 33) notifications.launch(Manifest.permission.POST_NOTIFICATIONS) }
    // a row without a thread opens nothing
    val open: (String) -> Unit = { id -> if (id.isNotEmpty()) { pane = ""; openThread.value = id } }
    val hasDetail = pane.isNotEmpty() || openThread.value != null
    val closeDetail = { pane = ""; openThread.value = null }

    val lists: @Composable () -> Unit = {
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.weight(1f)) {
                when (tab) {
                    0 -> InboxRoute(box, boxLoaded, listOf(notice, boxError).filter { it.isNotEmpty() }.joinToString(" "), open, reloadBox)
                    1 -> ThreadsRoute(notice, online, openThread.value ?: "", open, onNew = { pane = "new" })
                    2 -> RunningRoute(notice, box.counts, "pause" in can, open, reloadBox)
                    3 -> ScheduledRoute(notice, "runWake" in can, open, reloadBox)
                    else -> MoreRoute(notice, box.counts, "pause" in can, "accounts" in can, can, reloadBox, onPane = { pane = it })
                }
            }
            Tabs(box.counts, tab) { tab = it }
        }
    }
    // the one place that decides what is beside (or instead of) the tabs
    val detail: @Composable () -> Unit = {
        when (pane) {
            "usage" -> UsageRoute(notice, "accounts" in can, box.counts.working, closeDetail)
            "teams" -> TeamsRoute(notice, open, closeDetail)
            "notes" -> NotesRoute(notice, closeDetail)
            "todos" -> TodosRoute(notice, closeDetail)
            "watchers" -> WatchersRoute(notice, closeDetail)
            "settings" -> SettingsRoute(notice, online, "quiet" in can, closeDetail, onUnpaired = { told ->
                Drafts.clear()
                closeDetail()
                tab = 0
                pairNote = if (told) "" else "Hive on the computer could not be told. Unpair there too: Settings, General, Phone app."
                paired = false
            })
            "new" -> NewThreadRoute(notice, online, onDone = { id -> pane = ""; if (id != null) openThread.value = id })
            // keyed: another thread is another screen, never this one's text box with a different id behind it
            else -> { val id = openThread.value; if (id != null) key(id) { ThreadRoute(id, notice, online, can) { openThread.value = null } } }
        }
    }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth
        when {
            !paired -> PairRoute(pairNote) { pairNote = ""; paired = true; Relay.start(ctx) }
            // unfolded or a tablet: the tabs on the left, the open thread (or a new one) on the right
            wide >= 600.dp -> Row(Modifier.fillMaxSize()) {
                Box(Modifier.width(minOf(380.dp, wide * 0.42f)).fillMaxHeight()) { lists() }
                Box(Modifier.width(1.dp).fillMaxHeight().background(C.rule))
                Box(Modifier.weight(1f).fillMaxHeight()) {
                    if (hasDetail) detail() else Text("Pick a thread", Modifier.align(Alignment.Center), style = T.note)
                }
            }
            hasDetail -> detail()
            else -> lists()
        }
    }
}

@Composable
private fun PairRoute(note: String, onPaired: () -> Unit) {
    val ctx = LocalContext.current
    var text by remember { mutableStateOf("") }
    var err by remember { mutableStateOf("") }
    var paste by remember { mutableStateOf(false) }
    val take = { qr: String ->
        val (p, why) = Pairing.read(qr)
        if (p == null) err = why
        else try {
            Vault.save(ctx, p)
            text = ""
            onPaired()
        } catch (e: Exception) {
            // the Keystore makes no key that needs a screen lock on a phone without one
            err = "This phone could not store the pairing safely. Set a screen lock (PIN, pattern or password) and try again."
        }
    }
    val scan = rememberLauncherForActivityResult(ScanContract()) { r -> r.contents?.let(take) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) scan.launch(ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE).setPrompt("Scan the code in Hive: Settings, General, Phone app").setBeepEnabled(false))
        else { err = "Hive needs the camera to scan the code. Allow it, or paste the code instead."; paste = true }
    }
    PairScreen(note, err, text, paste, onScan = { camera.launch(Manifest.permission.CAMERA) }, onPasteMode = { paste = true }, onText = { text = it }, onPair = { take(text) })
}

@Composable
private fun InboxRoute(box: Inbox, loaded: Boolean, notice: String, onOpen: (String) -> Unit, reload: () -> Unit) {
    val scope = rememberCoroutineScope()
    val now = rememberNow()
    var err by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf("") }
    val act: (Need, suspend () -> Unit) -> Unit = { n, what ->
        busy = n.thread
        scope.launch { err = attempt { what() }; busy = ""; reload() }
    }
    InboxScreen(box, now, notice = listOf(notice, err).filter { it.isNotEmpty() }.joinToString(" "), busy = busy, loaded = loaded,
        // the app is unlocked here, so any of the choices may be picked, not only the ones a notification allows
        onAnswer = { n, o -> act(n) { Relay.ask("answer", mapOf("id" to n.thread, "ask" to n.askId, "answers" to JSONObject().put(n.question, o))) } },
        onOpen = onOpen,
        onRetry = { n -> act(n) { val text = "Try that again."; Relay.ask("send", mapOf("id" to n.thread, "text" to text, "mid" to Drafts.midFor(n.thread, text))); Drafts.pending.remove(n.thread) } },
        onDismiss = { n -> act(n) { Relay.ask("dismiss", mapOf("id" to n.thread)) } })
}

@Composable
private fun ThreadsRoute(notice: String, online: Boolean, open: String, onOpen: (String) -> Unit, onNew: () -> Unit) {
    val now = rememberNow()
    var rows by remember { mutableStateOf<List<ThreadRow>>(emptyList()) }
    var err by remember { mutableStateOf("") }
    var query by rememberSaveable { mutableStateOf("") }
    rememberLoader(every = { 15_000L }) { err = attempt { rows = Read.threads(Relay.ask("threads")) } }
    val drafts = Drafts.text.filter { it.value.isNotBlank() }.keys
    ThreadsScreen(rows, now, query, drafts, open, listOf(notice, err).filter { it.isNotEmpty() }.joinToString(" "), canNew = online, onQuery = { query = it }, onOpen = onOpen, onNew = onNew)
}

@Composable
private fun ThreadRoute(id: String, notice: String, online: Boolean, can: Collection<String>, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var v by remember { mutableStateOf(ThreadView()) }
    var loaded by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf("") }
    var leaving by remember { mutableStateOf(false) }
    var sentAsks by remember { mutableStateOf(emptySet<String>()) }
    val draft = Drafts.text[id] ?: ""
    val list = rememberLazyListState()
    // follow the end on the first load, after a send, and while the reader is already at the bottom; not when scrolled up
    var follow by remember { mutableStateOf(true) }
    val back: () -> Unit = { if (draft.isNotBlank() && !leaving) leaving = true else { leaving = false; onBack() } }
    BackHandler(onBack = back)
    // no notification for the thread that is on screen
    DisposableEffect(id) { Relay.viewing = id; onDispose { if (Relay.viewing == id) Relay.viewing = null } }
    // while Claude or its background work runs, look again every few seconds
    val reload = rememberLoader(id, every = { if (v.working || v.tasks.isNotEmpty()) 4000L else 0L }) {
        err = attempt {
            val t = Relay.ask("thread", mapOf("id" to id)).optJSONObject("thread") ?: throw RelayError("That thread is gone")
            val seen = list.layoutInfo
            if ((seen.visibleItemsInfo.lastOrNull()?.index ?: -1) >= seen.totalItemsCount - 2) follow = true
            v = Read.thread(t)
            loaded = true
        }
        if (follow && v.items.isNotEmpty()) list.scrollToItem(v.items.size - 1 + v.asks.size)
        follow = false
    }
    // an action and its failure, said: Stop that did not reach Hive must not look like it worked
    val act: (String, Map<String, Any>, (Boolean) -> Unit) -> Unit = { op, extra, done ->
        scope.launch {
            err = attempt { Relay.ask(op, extra) }
            done(err.isEmpty())
            reload()
        }
    }
    var settings by remember { mutableStateOf<ThreadSettings?>(null) }
    var settingsOpen by remember { mutableStateOf("") }
    val loadSettings: () -> Unit = { if ("threadSettings" in can) scope.launch { attempt { settings = ReadMore.settings(Relay.ask("threadSettings", mapOf("id" to id)).optJSONObject("settings")) } } }
    LaunchedEffect(id, v.working) { loadSettings() }
    // 3.1: context, what it waits on, its work, the points to rewind to, its PR gate
    var more by remember { mutableStateOf<ThreadMore?>(null) }
    var morePane by remember { mutableStateOf("") }
    var rewinding by remember { mutableStateOf("") }
    val now = rememberNow(5_000)
    val loadMore: () -> Unit = { if ("threadMore" in can) scope.launch { attempt { more = ReadMore2.more(Relay.ask("threadMore", mapOf("id" to id)).optJSONObject("more")) } } }
    LaunchedEffect(id, v.working, v.tasks.size) { loadMore() }
    LaunchedEffect(id, v.working) { while (v.working) { kotlinx.coroutines.delay(6_000); loadMore() } }
    val sendHow: (String, String) -> Unit = { text, how ->
        // the same text sent again after a try that got no answer carries the same id: Hive runs it once
        val mid = Drafts.midFor(id, text)
        follow = true
        // not this screen's own scope: a send that fails after the screen is left still puts the text back
        appScope.launch {
            val failed = attempt { Relay.ask("send", if (how.isEmpty()) mapOf("id" to id, "text" to text, "mid" to mid) else mapOf("id" to id, "text" to text, "mid" to mid, "how" to how)) }
            if (failed.isEmpty()) { Drafts.pending.remove(id); v = v.copy(working = true) }
            else if (Drafts.text[id].isNullOrEmpty()) Drafts.text[id] = text // unless something new was typed meanwhile
            err = failed
            reload()
        }
    }
    val send: (String) -> Unit = { text -> sendHow(text, "") }
    val mic = rememberMic(onText = { Drafts.text[id] = joinDraft(Drafts.text[id] ?: "", it) }, onError = { err = it })
    val how = "sendHow" in can
    // 3.2: the thread's changes, in place of the conversation until Back
    var changesOpen by remember { mutableStateOf(false) }
    if (changesOpen) { ChangesRoute(id, notice, online, "prMerge" in can) { changesOpen = false }; return }
    ThreadScreen(v, draft, online, loaded, err, notice, leaving, sentAsks, list,
        onBack = back, onStay = { leaving = false }, onLeave = { leaving = false; onBack() },
        onDraft = { Drafts.text[id] = it },
        onSend = { val text = draft.trim(); Drafts.text.remove(id); send(text) },
        // a quick reply is a short message, sent at once; what is in the text box stays there
        onQuick = { r -> send(r.text) },
        onStop = { act("stop", mapOf("id" to id)) { } },
        onStopTask = { t -> act("stopTask", mapOf("id" to id, "task" to t.id)) { } },
        onAnswer = { a, answers -> sentAsks = sentAsks + a.id; act("answer", mapOf("id" to id, "ask" to a.id, "answers" to answers)) { ok -> if (!ok) sentAsks = sentAsks - a.id } },
        onMic = mic,
        more = more, morePane = morePane, now = now, rewinding = rewinding, onMorePane = { morePane = it },
        onRewind = { p -> rewinding = p.uuid; scope.launch { err = attempt { Relay.ask("rewind", mapOf("id" to id, "uuid" to p.uuid)) }; rewinding = ""; if (err.isEmpty()) { morePane = ""; Drafts.text[id] = p.text }; reload(); loadMore() } },
        settings = settings?.copy(advisor = more?.advisor ?: ""), settingsOpen = settingsOpen, onSettingsOpen = { settingsOpen = it },
        onSetting = { what, value -> settingsOpen = ""; scope.launch { err = attempt { Relay.ask("setThread", mapOf("id" to id, "what" to what, "value" to value)) }; loadSettings() } },
        onQueue = if (how) ({ val text = draft.trim(); Drafts.text.remove(id); sendHow(text, "queue") }) else null,
        onInterrupt = if (how) ({ val text = draft.trim(); Drafts.text.remove(id); sendHow(text, "interrupt") }) else null,
        onChanges = if ("changes" in can) ({ changesOpen = true }) else null)
}

// A thread's branch, PR and files; a file's diff; the merge. Merge sends what the confirm showed (the PR's head sha as
// it was on screen) with a fresh mid and confirm = "merge"; Hive checks everything again before it merges.
@Composable
private fun ChangesRoute(id: String, notice: String, online: Boolean, canMerge: Boolean, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var changes by remember { mutableStateOf<Changes?>(null) }
    var err by remember { mutableStateOf("") }
    var file by remember { mutableStateOf<ChangeFile?>(null) }
    var diff by remember { mutableStateOf<DiffView?>(null) }
    var diffErr by remember { mutableStateOf("") }
    var confirming by remember { mutableStateOf<PrCard?>(null) }
    var merging by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<Pair<Boolean, String>?>(null) }
    val back: () -> Unit = { if (file != null) file = null else if (confirming != null && !merging) confirming = null else onBack() }
    BackHandler(onBack = back)
    val reload = rememberLoader(id) { err = attempt("changes") { changes = ReadChanges.changes(Relay.ask("changes", mapOf("id" to id)).optJSONObject("changes")) } }
    LaunchedEffect(file) {
        val f = file ?: return@LaunchedEffect
        diff = null
        diffErr = attempt("diffs") { diff = ReadChanges.diff(Relay.ask("diff", mapOf("id" to id, "path" to f.path, "area" to f.area)).optJSONObject("diff")) }
    }
    val open = file
    if (open != null) { DiffScreen(open, diff, listOf(notice, diffErr).filter { it.isNotEmpty() }.joinToString(" "), onBack = back); return }
    ChangesScreen(changes, notice, err, result, canMerge && online, confirming, merging,
        onBack = back, onFile = { file = it }, onAskMerge = { confirming = it; result = null }, onCancelMerge = { confirming = null },
        onMerge = { p ->
            merging = true
            val mid = java.util.UUID.randomUUID().toString()
            scope.launch {
                val failed = attempt { result = ReadChanges.merge(Relay.ask("prMerge", mapOf("id" to id, "mid" to mid, "headSha" to p.headSha, "confirm" to "merge")).optJSONObject("merge")) }
                if (failed.isNotEmpty()) result = false to failed
                merging = false
                confirming = null
                reload()
            }
        })
}

// ---- the 3.0 screens ----
@Composable
private fun NotesRoute(notice: String, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var notes by remember { mutableStateOf<List<Note>?>(null) }
    var err by remember { mutableStateOf("") }
    var editing by remember { mutableStateOf<String?>(null) }
    var draft by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    val back: () -> Unit = { if (editing != null) editing = null else onBack() }
    BackHandler(onBack = back)
    val reload = rememberLoader { err = attempt("notes") { notes = ReadMore.notes(Relay.ask("notes")) } }
    NotesScreen(notes, editing, draft, notice, err, saving, onBack = back,
        onOpen = { n -> editing = n.id; draft = n.text }, onNew = { editing = ""; draft = "" }, onDraft = { draft = it },
        onSave = {
            val id = editing ?: ""
            if (draft.isNotBlank() && !saving) {
                saving = true
                scope.launch {
                    err = attempt { Relay.ask("noteSave", mapOf("id" to id, "text" to draft, "mid" to java.util.UUID.randomUUID().toString())) }
                    saving = false
                    if (err.isEmpty()) editing = null
                    reload()
                }
            }
        })
}

@Composable
private fun TodosRoute(notice: String, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var todos by remember { mutableStateOf<List<Todo>?>(null) }
    var err by remember { mutableStateOf("") }
    var draft by remember { mutableStateOf("") }
    var showDone by remember { mutableStateOf(false) }
    BackHandler(onBack = onBack)
    val reload = rememberLoader(every = { 15_000L }) { err = attempt("todos") { todos = ReadMore.todos(Relay.ask("todos")) } }
    TodosScreen(todos, draft, notice, err, showDone, onBack = onBack, onDraft = { draft = it },
        onAdd = { val text = draft.trim(); draft = ""; scope.launch { err = attempt { Relay.ask("todoAdd", mapOf("text" to text, "mid" to java.util.UUID.randomUUID().toString())) }; reload() } },
        onToggle = { t -> scope.launch { err = attempt { Relay.ask("todoDone", mapOf("id" to t.id, "done" to (t.status != "done"))) }; reload() } },
        onShowDone = { showDone = !showDone })
}

@Composable
private fun WatchersRoute(notice: String, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var watchers by remember { mutableStateOf<List<Watcher>?>(null) }
    var err by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf("") }
    var done by remember { mutableStateOf("") }
    val now = rememberNow()
    BackHandler(onBack = onBack)
    val reload = rememberLoader(every = { 10_000L }) { err = attempt("watchers") { watchers = ReadMore.watchers(Relay.ask("watchers")) } }
    WatchersScreen(watchers, notice, err, busy, done, now, onBack = onBack, onRun = { w ->
        busy = w.id; done = ""
        scope.launch { err = attempt { Relay.ask("watcherRun", mapOf("id" to w.id)) }; if (err.isEmpty()) done = "${w.name} started a run."; busy = ""; reload() }
    })
}

// "Stop everything" as Running and More both offer it: the question first, then what was stopped, in words
private class StopAll(val asking: Boolean?, val done: String, val error: String, val ask: () -> Unit, val pause: (Boolean) -> Unit, val cancel: () -> Unit, val go: () -> Unit)

@Composable
private fun rememberStopAll(after: () -> Unit): StopAll {
    val scope = rememberCoroutineScope()
    var asking by remember { mutableStateOf<Boolean?>(null) }
    var done by remember { mutableStateOf("") }
    var err by remember { mutableStateOf("") }
    return StopAll(asking, done, err, ask = { asking = false; done = ""; err = "" }, pause = { asking = it }, cancel = { asking = null }, go = {
        val pause = asking == true
        asking = null
        scope.launch {
            err = attempt {
                val r = Relay.ask("stopAll", mapOf("wakeups" to pause))
                done = "Stopped ${Words.plural(r.optInt("threads"), "thread")} and ${Words.plural(r.optInt("tasks"), "background task")}." + if (r.optBoolean("wakeups")) " Wake-ups and loops are paused." else ""
            }
            after()
        }
    })
}

@Composable
private fun RunningRoute(notice: String, counts: Counts, canPause: Boolean, onOpen: (String) -> Unit, reloadBox: () -> Unit) {
    val scope = rememberCoroutineScope()
    var rows by remember { mutableStateOf<List<RunRow>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(emptySet<String>()) }
    val reload = rememberLoader(every = { 5_000L }) { err = attempt("what is running") { rows = Read.running(Relay.ask("running")); loaded = true } }
    val stop = rememberStopAll { reload(); reloadBox() }
    RunningScreen(rows, listOf(notice, err, stop.error, stop.done).filter { it.isNotEmpty() }.joinToString(" "), busy, stop.asking, canPause, counts.threads, counts.scheduled, loaded,
        onStop = { r ->
            val k = r.thread + ":" + r.id
            busy = busy + k
            scope.launch { err = attempt { Relay.ask("stopTask", mapOf("id" to r.thread, "task" to r.id)) }; busy = busy - k; reload(); reloadBox() }
        },
        onOpen = onOpen, onAskStopAll = stop.ask, onPause = stop.pause, onCancelStopAll = stop.cancel, onStopAll = stop.go)
}

@Composable
private fun ScheduledRoute(notice: String, canRun: Boolean, onOpen: (String) -> Unit, reloadBox: () -> Unit) {
    val scope = rememberCoroutineScope()
    val now = rememberNow()
    var wakes by remember { mutableStateOf<List<Wake>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(emptySet<String>()) }
    val reload = rememberLoader(every = { 30_000L }) { err = attempt("wake-ups") { wakes = Read.wakes(Relay.ask("wakeups")); loaded = true } }
    val act: (Wake, String) -> Unit = { w, op ->
        val k = w.kind + ":" + w.id
        busy = busy + k
        scope.launch { err = attempt { Relay.ask(op, mapOf("kind" to w.kind, "id" to w.id)) }; busy = busy - k; reload(); reloadBox() }
    }
    ScheduledScreen(wakes, now, canRun, listOf(notice, err).filter { it.isNotEmpty() }.joinToString(" "), busy, loaded, onRun = { act(it, "runWake") }, onCancel = { act(it, "cancelWakeup") }, onOpen = onOpen)
}

@Composable
private fun MoreRoute(notice: String, counts: Counts, canPause: Boolean, accounts: Boolean, can: Collection<String>, reloadBox: () -> Unit, onPane: (String) -> Unit) {
    val stop = rememberStopAll { reloadBox() }
    MoreScreen(listOf(notice, stop.error).filter { it.isNotEmpty() }.joinToString(" "), stop.asking, canPause, counts.threads, counts.running, counts.scheduled, stop.done, accounts,
        onAskStopAll = stop.ask, onPause = stop.pause, onCancelStopAll = stop.cancel, onStopAll = stop.go,
        onUsage = { onPane("usage") }, onTeams = { onPane("teams") }, onNew = { onPane("new") }, onSettings = { onPane("settings") },
        onNotes = if ("notes" in can) ({ onPane("notes") }) else null, onTodos = if ("todos" in can) ({ onPane("todos") }) else null, onWatchers = if ("watchers" in can) ({ onPane("watchers") }) else null)
}

@Composable
private fun UsageRoute(notice: String, canAccounts: Boolean, working: Int, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val now = rememberNow()
    var plan by remember { mutableStateOf("") }
    var limits by remember { mutableStateOf<List<Limit>?>(null) }
    var accounts by remember { mutableStateOf<List<Account>?>(null) }
    var wakes by remember { mutableStateOf<List<Wake>>(emptyList()) }
    var err by remember { mutableStateOf("") }
    var switching by remember { mutableStateOf<Account?>(null) }
    var busy by remember { mutableStateOf(false) }
    BackHandler(onBack = onBack)
    val reload = rememberLoader(canAccounts, every = { 60_000L }) {
        err = attempt("usage") {
            val u = Relay.ask("usage").optJSONObject("usage") ?: JSONObject()
            plan = if (u.isNull("plan")) "" else u.optString("plan").replaceFirstChar { it.uppercase() }
            limits = Read.limits(u)
            // the accounts only when this Hive has account profiles; otherwise the zone is not drawn at all
            accounts = if (canAccounts) Read.accounts(Relay.ask("accounts")) else null
            // the guard names the wake-ups due before the reset: asked for only while a window is close to its limit
            if (Usage.guard(limits ?: emptyList(), System.currentTimeMillis()) != null) wakes = Read.wakes(Relay.ask("wakeups"))
        }
    }
    UsageScreen(limits, now, plan, accounts, notice, err, switching, busy, working, wakes, onBack = onBack, onPick = { switching = it }, onCancelSwitch = { switching = null }, onSwitch = { a ->
        busy = true
        scope.launch { err = attempt { Relay.ask("switchAccount", mapOf("id" to a.id)) }; busy = false; switching = null; reload() }
    })
}

@Composable
private fun TeamsRoute(notice: String, onOpen: (String) -> Unit, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var teams by remember { mutableStateOf<List<Team>?>(null) }
    var err by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf("") }
    BackHandler(onBack = onBack)
    val reload = rememberLoader(every = { 5000L }) { err = attempt("teams") { teams = Read.teams(Relay.ask("teams")) } }
    TeamsScreen(teams, notice, err, busy, onBack = onBack, onOpen = onOpen, onPause = { t ->
        busy = t.id
        scope.launch { err = attempt { Relay.ask(if (t.word == "PAUSED") "teamResume" else "teamPause", mapOf("id" to t.id)) }; busy = ""; reload() }
    })
}

// onDone: the new thread's id when Hive said which one it started (it is opened), null for Back or an older Hive
@Composable
private fun NewThreadRoute(notice: String, online: Boolean, onDone: (String?) -> Unit) {
    val scope = rememberCoroutineScope()
    var folders by remember { mutableStateOf<List<String>?>(null) } // null until Hive has said which there are
    var err by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var leaving by remember { mutableStateOf(false) }
    val text = Drafts.text[""] ?: ""
    val folder = Drafts.newFolder
    val back: () -> Unit = { if (text.isNotBlank() && !busy && !leaving) leaving = true else { leaving = false; onDone(null) } }
    BackHandler(onBack = back)
    // asked again whenever the computer comes back, so a first try that failed does not leave the list empty
    rememberLoader {
        val failed = attempt {
            val got = strs(Relay.ask("threads").optJSONArray("folders"))
            folders = got
            if (Drafts.newFolder !in got) Drafts.newFolder = got.firstOrNull() ?: ""
        }
        if (!busy) err = failed
    }
    val mic = rememberMic(onText = { Drafts.text[""] = joinDraft(Drafts.text[""] ?: "", it) }, onError = { err = it })
    NewThreadScreen(folders, folder, text, busy, online, err, notice, leaving,
        onBack = back, onStay = { leaving = false }, onLeave = { leaving = false; onDone(null) },
        onFolder = { Drafts.newFolder = it }, onText = { Drafts.text[""] = it }, onMic = mic,
        onStart = {
            busy = true
            val body = text.trim()
            val mid = Drafts.midFor("", body + "\n" + folder)
            scope.launch {
                var started: String? = null
                err = attempt { started = Relay.ask("new", mapOf("folder" to folder, "text" to body, "mid" to mid)).optString("thread").ifEmpty { null } }
                busy = false
                if (err.isEmpty()) { Drafts.pending.remove(""); Drafts.text.remove(""); onDone(started) }
            }
        })
}

@Composable
private fun SettingsRoute(notice: String, online: Boolean, syncs: Boolean, onBack: () -> Unit, onUnpaired: (Boolean) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val state by Relay.state.collectAsState()
    val skew by Relay.skew.collectAsState()
    var quiet by remember { mutableStateOf(Settings.quiet(ctx)) }
    var buttons by remember { mutableStateOf(Settings.buttons(ctx)) }
    var unpair by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf("") }
    BackHandler(onBack = onBack)
    // when Hive keeps quiet hours too, the two are one setting: read from Hive on opening, written to it on a change
    rememberLoader(syncs) {
        if (!syncs) return@rememberLoader
        err = attempt { Read.quiet(Relay.ask("quiet").optJSONObject("quiet"))?.let { quiet = it; Settings.setQuiet(ctx, it) } }
    }
    val setQuiet: (Quiet) -> Unit = { q ->
        quiet = q
        Settings.setQuiet(ctx, q)
        if (syncs) scope.launch { err = attempt { Relay.ask("quiet", mapOf("set" to JSONObject().put("on", q.on).put("from", q.from).put("to", q.to))) } }
    }
    val pick: (String, (String) -> Unit) -> Unit = { now, set ->
        val m = Words.minutes(now) ?: 0
        android.app.TimePickerDialog(ctx, { _, h, min -> set(Words.hhmm(h * 60 + min)) }, m / 60, m % 60, true).show()
    }
    val known = Vault.known(ctx)
    val word = when (state) { Relay.State.Online -> "online"; Relay.State.RelayOnly -> "computer offline"; Relay.State.Connecting -> "connecting"; Relay.State.Off -> "not connected"; Relay.State.Unpaired -> "unpaired" }
    val clock = if (state != Relay.State.Online) "" else "clock within ${String.format(java.util.Locale.ROOT, "%.1f", kotlin.math.abs(skew) / 1000.0)} s"
    val version = remember { runCatching { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName }.getOrNull() ?: "" }
    val can by Relay.can.collectAsState()
    var computer by remember { mutableStateOf("") }
    rememberLoader("versions" in can) { if ("versions" in can) attempt { computer = ReadMore2.versions(Relay.ask("versions").optJSONObject("versions")) } }
    SettingsScreen(quiet, buttons, known?.relay?.removePrefix("https://") ?: "", word, clock, syncs, unpair, online, listOf(notice, err).filter { it.isNotEmpty() }.joinToString(" "), version, computer,
        onBack = onBack, onQuiet = { setQuiet(quiet.copy(on = it)) },
        onFrom = { pick(quiet.from) { setQuiet(quiet.copy(from = it)) } }, onTo = { pick(quiet.to) { setQuiet(quiet.copy(to = it)) } },
        onButtons = { buttons = it; Settings.setButtons(ctx, it) },
        onAskUnpair = { unpair = true }, onCancelUnpair = { unpair = false },
        onUnpair = { unpair = false; scope.launch { onUnpaired(Relay.unpair(ctx)) } })
}
