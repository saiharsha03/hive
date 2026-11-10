package dev.hive.mobile

// The app: a fingerprint to open it, pairing (scan the QR Hive shows, or paste it), the threads, one thread (read,
// send, stop, its background work) and a new thread, the running teams, the wake-ups and usage. Everything goes to
// Hive on the computer through the relay, sealed.
import android.Manifest
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.security.keystore.KeyPermanentlyInvalidatedException
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
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import com.mikepenz.markdown.m3.Markdown
import com.mikepenz.markdown.m3.markdownColor
import com.mikepenz.markdown.m3.markdownTypography
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
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
    private val main = android.os.Handler(android.os.Looper.getMainLooper())
    // two minutes off the screen: the pairing key leaves memory even if the app is never looked at again
    private val forget = Runnable { if (!Relay.visible) Vault.lock() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // nothing of a thread in the recent-apps picture, a screenshot or a screen recording
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        enableEdgeToEdge()
        openThread.value = intent.getStringExtra("thread")?.takeIf { it.isNotEmpty() }
        // the screen was rebuilt (a setting changed) while the app was open and unlocked: no second fingerprint
        unlocked.value = Vault.session != null && !away()
        if (!unlocked.value) Vault.lock()
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Color(0xFFFFC83D), background = Color(0xFF15161A), surface = Color(0xFF1D1F24))) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    if (!unlocked.value) Locked(lockNote.value, broken.value, onUnlock = { unlock() }, onForget = { forgetPairing() }) else App(openThread)
                }
            }
        }
        if (!unlocked.value) unlock()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra("thread")?.takeIf { it.isNotEmpty() }?.let { openThread.value = it }
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

@Composable
private fun Locked(note: String, broken: Boolean, onUnlock: () -> Unit, onForget: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text("Hive is locked", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(16.dp))
        if (broken) {
            // the Keystore dropped the key (the screen lock was removed or reset): the pairing cannot be read again
            Text("The pairing saved on this phone can no longer be opened, because the screen lock changed. Pair this phone again in Hive on your computer.", color = Color.Gray, textAlign = TextAlign.Center)
            Spacer(Modifier.height(16.dp))
            Button(onClick = onForget) { Text("Pair again") }
        } else {
            Button(onClick = onUnlock) { Text("Unlock") }
            if (note.isNotEmpty()) { Spacer(Modifier.height(16.dp)); Text(note, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center) }
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

private fun objs(a: JSONArray?): List<JSONObject> = if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it) }

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

// "You have unsent text": Back from a screen with something typed asks first. The text is kept either way.
@Composable
private fun LeaveDialog(onStay: () -> Unit, onLeave: () -> Unit) {
    AlertDialog(onDismissRequest = onStay, title = { Text("Leave without sending?") },
        text = { Text("What you typed has not been sent. It is kept here as a draft.") },
        confirmButton = { TextButton(onClick = onLeave) { Text("Leave") } },
        dismissButton = { TextButton(onClick = onStay) { Text("Stay") } })
}

@Composable
private fun App(openThread: MutableState<String?>) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var paired by remember { mutableStateOf(Vault.session != null) }
    var pane by rememberSaveable { mutableStateOf("") } // "new", "usage", "teams", "wakeups", or "" for the open thread
    var pairNote by remember { mutableStateOf("") }
    // Android 13+ asks before an app may show notifications
    val notifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(Unit) { if (android.os.Build.VERSION.SDK_INT >= 33) notifications.launch(Manifest.permission.POST_NOTIFICATIONS) }
    // a thread opened from Teams or Wake-ups closes that screen; a row without a thread opens nothing
    val open: (String) -> Unit = { id -> if (id.isNotEmpty()) { pane = ""; openThread.value = id } }
    val list: @Composable () -> Unit = {
        Threads(onOpen = open, onNew = { pane = "new" }, onPane = { pane = it },
            onUnpair = {
                scope.launch {
                    val told = Relay.unpair(ctx)
                    Drafts.clear()
                    openThread.value = null
                    pane = ""
                    pairNote = if (told) "" else "Hive on the computer could not be told. Unpair there too: Settings > General > Phone app."
                    paired = false
                }
            })
    }
    val hasDetail = pane.isNotEmpty() || openThread.value != null
    // the one place that decides what is beside (or instead of) the thread list
    val detail: @Composable () -> Unit = {
        when {
            pane == "usage" -> UsageScreen(onBack = { pane = "" })
            pane == "teams" -> TeamsScreen(onOpen = open, onBack = { pane = "" })
            pane == "wakeups" -> WakeupsScreen(onOpen = open, onBack = { pane = "" })
            pane == "new" -> NewThread(onDone = { id -> pane = ""; if (id != null) openThread.value = id })
            // keyed: another thread is another screen, never this one's text box with a different id behind it
            else -> { val id = openThread.value; if (id != null) key(id) { ThreadScreen(id) { openThread.value = null } } }
        }
    }
    BoxWithConstraints(Modifier.fillMaxSize().systemBarsPadding().imePadding()) {
        val wide = maxWidth
        when {
            !paired -> PairScreen(pairNote) { pairNote = ""; paired = true; Relay.start(ctx) }
            // unfolded or a tablet: the threads on the left, the open thread (or a new one) on the right
            wide >= 600.dp -> Row(Modifier.fillMaxSize()) {
                Box(Modifier.width(minOf(360.dp, wide * 0.4f)).fillMaxHeight()) { list() }
                VerticalDivider(color = Color(0x22FFFFFF))
                Box(Modifier.weight(1f).fillMaxHeight()) {
                    if (hasDetail) detail() else Text("Pick a thread", Modifier.align(Alignment.Center), color = Color.Gray)
                }
            }
            hasDetail -> detail()
            else -> list()
        }
    }
}

@Composable
private fun PairScreen(note: String, onPaired: () -> Unit) {
    val ctx = LocalContext.current
    var text by remember { mutableStateOf("") }
    var err by remember { mutableStateOf("") }
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
        if (ok) scan.launch(ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE).setPrompt("Scan the code in Hive: Settings > General > Phone app").setBeepEnabled(false))
        else err = "Hive needs the camera to scan the code. Allow it, or paste the code instead."
    }
    Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Pair with Hive", style = MaterialTheme.typography.headlineSmall)
        if (note.isNotEmpty()) Text(note, color = Color(0xFFE0A030))
        Text("In Hive on your computer: Settings > General > Phone app > Pair. Then scan the code it shows.", color = Color.Gray)
        Button(onClick = { camera.launch(Manifest.permission.CAMERA) }, Modifier.fillMaxWidth()) { Text("Scan the code") }
        OutlinedTextField(text, { text = it }, Modifier.fillMaxWidth(), label = { Text("Or paste the code") }, minLines = 3)
        OutlinedButton(onClick = { take(text) }, Modifier.fillMaxWidth(), enabled = text.isNotBlank()) { Text("Pair") }
        if (err.isNotEmpty()) Text(err, color = MaterialTheme.colorScheme.error)
    }
}

@Composable
private fun StatusLine() {
    val s by Relay.state.collectAsState()
    val trouble by Relay.trouble.collectAsState()
    val skew by Relay.skew.collectAsState()
    val (label, color) = when (s) {
        Relay.State.Online -> "Computer online" to Color(0xFF5BC27A)
        Relay.State.RelayOnly -> "Computer offline (Hive closed or asleep)" to Color(0xFFE0A030)
        Relay.State.Connecting -> "Connecting…" to Color.Gray
        Relay.State.Off -> "Not connected, trying again…" to Color(0xFFE05050)
        Relay.State.Unpaired -> "This phone is no longer paired. Unpair it here (⋮), then pair again in Hive." to Color(0xFFE05050)
    }
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(8.dp).background(color, RoundedCornerShape(4.dp)))
            Spacer(Modifier.width(8.dp))
            Text(label, fontSize = 13.sp, color = Color.Gray)
        }
        if (trouble.isNotEmpty()) Text(trouble, fontSize = 13.sp, color = MaterialTheme.colorScheme.error)
        // Hive refuses requests dated more than two minutes off its own clock
        val min = kotlin.math.abs(skew) / 60_000
        if (kotlin.math.abs(skew) > 90_000) Text("This phone's clock is ${if (min < 1) "over a minute" else "$min min"} ${if (skew > 0) "behind" else "ahead of"} the computer's. Hive refuses requests when they differ by more than 2 minutes: set the phone's clock to automatic.", fontSize = 13.sp, color = Color(0xFFE0A030))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Threads(onOpen: (String) -> Unit, onNew: () -> Unit, onPane: (String) -> Unit, onUnpair: () -> Unit) {
    val state by Relay.state.collectAsState()
    var rows by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var err by remember { mutableStateOf("") }
    var menu by remember { mutableStateOf(false) }
    var unpair by remember { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    var refreshing by remember { mutableStateOf(false) }
    val reload = rememberLoader {
        err = attempt {
            // a row needs an id, once: the list is keyed by it
            rows = objs(Relay.ask("threads").optJSONArray("threads")).filter { it.optString("id").isNotEmpty() }.distinctBy { it.optString("id") }
        }
        refreshing = false
    }
    // the search filters the rows already here, by title and folder
    val q = query.trim()
    val shown = if (q.isEmpty()) rows else rows.filter { it.optString("title").contains(q, true) || it.optString("folder").contains(q, true) }
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Threads", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
            Button(onClick = onNew, enabled = state == Relay.State.Online) { Text("New") }
            Box {
                TextButton(onClick = { menu = true }) { Text("⋮", fontSize = 20.sp) }
                DropdownMenu(menu, { menu = false }) {
                    DropdownMenuItem(text = { Text("Teams") }, onClick = { menu = false; onPane("teams") })
                    DropdownMenuItem(text = { Text("Wake-ups") }, onClick = { menu = false; onPane("wakeups") })
                    DropdownMenuItem(text = { Text("Usage") }, onClick = { menu = false; onPane("usage") })
                    DropdownMenuItem(text = { Text("Unpair this phone") }, onClick = { menu = false; unpair = true })
                }
            }
        }
        // unpairing means scanning a new code in Hive, so ask first
        if (unpair) AlertDialog(onDismissRequest = { unpair = false }, title = { Text("Unpair this phone?") },
            text = { Text("This phone forgets the pairing, and Hive on your computer is told to drop it too" + (if (state == Relay.State.Online) "." else " (the computer is not reachable now: unpair there as well, in Settings > General > Phone app).") + " To use the app again you pair it anew in Hive.") },
            confirmButton = { TextButton(onClick = { unpair = false; onUnpair() }) { Text("Unpair", color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { unpair = false }) { Text("Cancel") } })
        StatusLine()
        if (err.isNotEmpty()) Text(err, color = MaterialTheme.colorScheme.error)
        OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth().padding(top = 8.dp), singleLine = true, placeholder = { Text("Search threads") },
            trailingIcon = { if (query.isNotEmpty()) TextButton(onClick = { query = "" }) { Text("✕") } })
        PullToRefreshBox(refreshing, { if (state == Relay.State.Online) { refreshing = true; reload() } }, Modifier.fillMaxSize().padding(top = 8.dp)) {
        LazyColumn(Modifier.fillMaxSize()) {
            // Hive sends each thread's sidebar section, in order; an older Hive sends none, so the list stays flat
            sections(shown).forEach { (section, group) ->
            if (section.isNotEmpty()) item(key = "section:$section") {
                Text(sectionLabels[section] ?: section, style = MaterialTheme.typography.labelLarge, color = Color.Gray, modifier = Modifier.padding(top = 16.dp, bottom = 4.dp))
            }
            items(group, key = { "thread:" + it.optString("id") }) { t ->
                val st = t.optString("state")
                val id = t.optString("id")
                Column(Modifier.fillMaxWidth().clickable { onOpen(id) }.padding(vertical = 10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (st != "idle") Text(if (st == "working") "● " else "◆ ", color = if (st == "working") Color(0xFF5BA8F0) else Color(0xFFE0A030))
                        Text(t.optString("title"), Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
                        Text(whenLabel(t.optLong("updated")), Modifier.padding(start = 8.dp), fontSize = 12.sp, color = Color.Gray)
                    }
                    // a thread with text typed and not sent says so
                    val draft = if (Drafts.text[id].isNullOrBlank()) "" else "Draft"
                    Text(listOf(draft, t.optString("folder"), t.optString("note")).filter { it.isNotEmpty() }.joinToString(" · "), fontSize = 12.sp, color = Color.Gray, maxLines = 1)
                }
                HorizontalDivider(color = Color(0x22FFFFFF))
            }
            }
        }
        }
    }
}

// A time for a row: the time alone if today, else with the date. full: the weekday too (a wake-up to come); short:
// "MMM d" or the date ("" from an older Hive that sends no time)
private fun whenLabel(ms: Long, full: Boolean = false): String {
    if (ms <= 0) return ""
    val at = java.time.Instant.ofEpochMilli(ms).atZone(java.time.ZoneId.systemDefault())
    val today = java.time.LocalDate.now()
    val time = java.time.format.DateTimeFormatter.ofLocalizedTime(java.time.format.FormatStyle.SHORT)
    val f = when {
        at.toLocalDate() == today -> time
        full -> return at.format(java.time.format.DateTimeFormatter.ofPattern("EEE MMM d, ")) + at.format(time)
        at.year == today.year -> java.time.format.DateTimeFormatter.ofPattern("MMM d")
        else -> java.time.format.DateTimeFormatter.ofLocalizedDate(java.time.format.FormatStyle.SHORT)
    }
    return at.format(f)
}

private val sectionOrder = listOf("watchers", "pinned", "waiting", "working", "dependabot", "recent")
private val sectionLabels = mapOf("watchers" to "Watchers", "pinned" to "Pinned", "waiting" to "Waiting for you", "working" to "Working", "dependabot" to "Dependabot", "recent" to "Recent")

// rows grouped by section in the sidebar's order (an unknown section from a newer Hive goes last); "" = no sections
private fun sections(rows: List<JSONObject>): List<Pair<String, List<JSONObject>>> =
    rows.groupBy { it.optString("section") }.toList().sortedBy { (k, _) -> sectionOrder.indexOf(k).let { if (it < 0) sectionOrder.size else it } }

@Composable
private fun ThreadScreen(id: String, onBack: () -> Unit) {
    val state by Relay.state.collectAsState()
    val scope = rememberCoroutineScope()
    var title by remember { mutableStateOf("") }
    var items by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var working by remember { mutableStateOf(false) }
    var asks by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var tasks by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var err by remember { mutableStateOf("") }
    var leaving by remember { mutableStateOf(false) }
    val draft = Drafts.text[id] ?: ""
    val list = rememberLazyListState()
    // follow the end on the first load, after a send, and while the reader is already at the bottom; not when scrolled up
    var follow by remember { mutableStateOf(true) }
    val back: () -> Unit = { if (draft.isNotBlank()) leaving = true else onBack() }
    BackHandler(onBack = back)
    if (leaving) LeaveDialog(onStay = { leaving = false }, onLeave = { leaving = false; onBack() })
    // no notification for the thread that is on screen
    DisposableEffect(id) { Relay.viewing = id; onDispose { if (Relay.viewing == id) Relay.viewing = null } }
    // while Claude or its background work runs, look again every few seconds
    val reload = rememberLoader(id, every = { if (working || tasks.isNotEmpty()) 4000L else 0L }) {
        err = attempt {
            val t = Relay.ask("thread", mapOf("id" to id)).optJSONObject("thread") ?: throw RelayError("That thread is gone")
            title = t.optString("title")
            working = t.optBoolean("working")
            val seen = list.layoutInfo
            if ((seen.visibleItemsInfo.lastOrNull()?.index ?: -1) >= seen.totalItemsCount - 2) follow = true
            items = objs(t.optJSONArray("items"))
            // Claude's open questions (an older Hive sends none)
            asks = objs(t.optJSONArray("asks")).distinctBy { it.optString("id") }
            // its running background work (a 1.x Hive sends none)
            tasks = objs(t.optJSONArray("tasks"))
        }
        if (follow && items.isNotEmpty()) list.scrollToItem(items.size - 1 + asks.size)
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
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = back) { Text("‹ Back") }
            Text(title, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
            if (working) TextButton(onClick = { act("stop", mapOf("id" to id)) { } }) { Text("Stop", color = MaterialTheme.colorScheme.error) }
        }
        Box(Modifier.padding(horizontal = 16.dp)) { StatusLine() }
        if (err.isNotEmpty()) Text(err, Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.error)
        if (tasks.isNotEmpty()) BackgroundWork(tasks) { task -> act("stopTask", mapOf("id" to id, "task" to task)) { } }
        LazyColumn(Modifier.weight(1f).padding(horizontal = 12.dp), state = list) {
            items(items) { it -> Item(it) }
            items(asks, key = { "ask:" + it.optString("id") }) { a ->
                AskCard(a) { answers, done -> act("answer", mapOf("id" to id, "ask" to a.optString("id"), "answers" to answers), done) }
            }
            if (working && asks.isEmpty()) item { Text("Claude is working…", Modifier.padding(8.dp), color = Color(0xFF5BA8F0), fontSize = 13.sp) }
        }
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.Bottom) {
            OutlinedTextField(draft, { Drafts.text[id] = it }, Modifier.weight(1f), placeholder = { Text(if (working) "Steer Claude…" else "Message Claude…") }, maxLines = 6)
            Spacer(Modifier.width(8.dp))
            Button(enabled = draft.isNotBlank() && state == Relay.State.Online, onClick = {
                val text = draft.trim()
                // the same text sent again after a try that got no answer carries the same id: Hive runs it once
                val mid = Drafts.midFor(id, text)
                Drafts.text.remove(id)
                follow = true
                // not this screen's own scope: a send that fails after the screen is left still puts the text back
                appScope.launch {
                    val failed = attempt { Relay.ask("send", mapOf("id" to id, "text" to text, "mid" to mid)) }
                    if (failed.isEmpty()) { Drafts.pending.remove(id); working = true }
                    else if (Drafts.text[id].isNullOrEmpty()) Drafts.text[id] = text // unless something new was typed meanwhile
                    err = failed
                    reload()
                }
            }) { Text("Send") }
        }
    }
}

@Composable
private fun Item(it: JSONObject) {
    val t = it.optString("t")
    when (it.optString("k")) {
        "you" -> Box(Modifier.fillMaxWidth().padding(vertical = 6.dp), contentAlignment = Alignment.CenterEnd) {
            SelectionContainer { Text(t, Modifier.background(Color(0xFF2A3140), RoundedCornerShape(12.dp)).padding(10.dp).widthIn(max = 320.dp)) }
        }
        "claude" -> ClaudeText(t)
        "tool" -> Text("› $t", Modifier.padding(vertical = 2.dp), fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = Color.Gray, maxLines = 2, overflow = TextOverflow.Ellipsis)
        else -> Text(t, Modifier.padding(vertical = 4.dp), fontSize = 12.sp, color = Color.Gray)
    }
}

// Claude writes Markdown. Takes the text alone so a refresh that brings the same text skips it (no re-parse)
@Composable
private fun ClaudeText(t: String) {
    val type = MaterialTheme.typography
    val mono = type.bodyMedium.copy(fontFamily = FontFamily.Monospace, fontSize = 13.sp)
    // long-press selects and copies; one message at a time, so taps and scrolling in the list stay as they were
    SelectionContainer { Markdown(t, modifier = Modifier.padding(vertical = 6.dp),
        colors = markdownColor(linkText = MaterialTheme.colorScheme.primary, codeBackground = Color(0xFF262930), inlineCodeBackground = Color(0xFF262930)),
        // phone sized headings: the defaults are display sizes
        typography = markdownTypography(h1 = type.titleLarge, h2 = type.titleMedium, h3 = type.titleSmall, h4 = type.titleSmall, h5 = type.titleSmall, h6 = type.titleSmall, code = mono, inlineCode = mono)) }
}

// onDone: the new thread's id when Hive said which one it started (it is opened), null for Back or an older Hive
@Composable
private fun NewThread(onDone: (String?) -> Unit) {
    val state by Relay.state.collectAsState()
    val scope = rememberCoroutineScope()
    var folders by remember { mutableStateOf<List<String>?>(null) } // null until Hive has said which there are
    var err by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var leaving by remember { mutableStateOf(false) }
    val text = Drafts.text[""] ?: ""
    val folder = Drafts.newFolder
    val back: () -> Unit = { if (text.isNotBlank() && !busy) leaving = true else onDone(null) }
    BackHandler(onBack = back)
    if (leaving) LeaveDialog(onStay = { leaving = false }, onLeave = { leaving = false; onDone(null) })
    // asked again whenever the computer comes back, so a first try that failed does not leave the list empty
    rememberLoader {
        val failed = attempt {
            val a = Relay.ask("threads").optJSONArray("folders")
            val got = if (a == null) emptyList() else (0 until a.length()).map { a.optString(it) }.filter { it.isNotEmpty() }
            folders = got
            if (Drafts.newFolder !in got) Drafts.newFolder = got.firstOrNull() ?: ""
        }
        if (!busy) err = failed
    }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = back) { Text("‹ Back") }
            Text("New thread", style = MaterialTheme.typography.titleLarge)
        }
        Box { StatusLine() }
        Text("Folder", color = Color.Gray, fontSize = 13.sp)
        if (folders == null) Text("Asking Hive for the folders…", color = Color.Gray, fontSize = 13.sp)
        LazyColumn(Modifier.heightIn(max = 220.dp)) {
            items(folders ?: emptyList()) { f ->
                Row(Modifier.fillMaxWidth().clickable { Drafts.newFolder = f }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(selected = folder == f, onClick = { Drafts.newFolder = f })
                    Text(f.substringAfterLast('\\').substringAfterLast('/'), maxLines = 1)
                }
            }
        }
        OutlinedTextField(text, { Drafts.text[""] = it }, Modifier.fillMaxWidth(), label = { Text("What should Claude do?") }, minLines = 4)
        // not before Hive has listed the folders: a thread is never started in a folder nobody chose
        Button(enabled = text.isNotBlank() && !busy && folders != null && state == Relay.State.Online, modifier = Modifier.fillMaxWidth(), onClick = {
            busy = true
            val body = text.trim()
            val mid = Drafts.midFor("", body + "\n" + folder)
            scope.launch {
                var started: String? = null
                err = attempt { started = Relay.ask("new", mapOf("folder" to folder, "text" to body, "mid" to mid)).optString("thread").ifEmpty { null } }
                busy = false
                if (err.isEmpty()) { Drafts.pending.remove(""); Drafts.text.remove(""); onDone(started) }
            }
        }) { Text(if (busy) "Starting…" else "Start") }
        if (err.isNotEmpty()) Text(err, color = MaterialTheme.colorScheme.error)
    }
}

// "3h 12m" until an ISO time, like the desktop status bar
private fun untilReset(iso: String): String = runCatching {
    val m = maxOf(0L, java.time.Duration.between(java.time.Instant.now(), java.time.Instant.parse(iso)).toMinutes())
    val d = m / 1440; val h = (m % 1440) / 60
    if (d > 0) "${d}d ${h}h" else if (h > 0) "${h}h ${m % 60}m" else "${m}m"
}.getOrDefault("")

// The plan limits as the desktop's usage popover shows them (/usage in Claude Code); an older Hive has no such request
@Composable
private fun UsageScreen(onBack: () -> Unit) {
    var plan by remember { mutableStateOf("") }
    var rows by remember { mutableStateOf<List<JSONObject>?>(null) }
    var err by remember { mutableStateOf("") }
    BackHandler(onBack = onBack)
    rememberLoader {
        err = attempt("usage") {
            val u = Relay.ask("usage").optJSONObject("usage") ?: JSONObject()
            plan = if (u.isNull("plan")) "" else u.optString("plan")
            rows = objs(u.optJSONArray("rows"))
        }
    }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("‹ Back") }
            Text(if (plan.isEmpty()) "Usage" else "Usage (${plan.replaceFirstChar { it.uppercase() }})", style = MaterialTheme.typography.titleLarge)
        }
        StatusLine()
        if (err.isNotEmpty()) Text(err, color = MaterialTheme.colorScheme.error)
        if (rows?.isEmpty() == true) Text("No reading yet.", color = Color.Gray)
        rows?.forEach { r ->
            val pct = r.optDouble("pct", 0.0)
            val color = if (pct >= 90) Color(0xFFE05050) else if (pct >= 70) Color(0xFFE0A030) else Color(0xFF50B070)
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(r.optString("label"))
                LinearProgressIndicator(progress = { (pct / 100).toFloat().coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth(), color = color)
                val reset = if (r.isNull("resetsAt")) "" else untilReset(r.optString("resetsAt"))
                Text("${pct.toInt()}% used" + if (reset.isNotEmpty()) ", resets in $reset" else "", fontSize = 12.sp, color = Color.Gray)
            }
        }
    }
}

// state words in colour, as on the desktop (no dots)
private fun stateColor(word: String): Color = when (word.lowercase()) {
    "working" -> Color(0xFF5BA8F0)
    "waiting", "paused" -> Color(0xFFE0A030)
    "closed" -> Color(0xFF6A6D75)
    else -> Color.Gray
}

@Composable
private fun StateWord(word: String) = Text(word.uppercase(), fontSize = 11.sp, color = stateColor(word), fontWeight = FontWeight.SemiBold, letterSpacing = 0.5.sp)

// A thread's running subagents, shells, workflows and Codex runs with their live line; Stop ends one of them
@Composable
private fun BackgroundWork(tasks: List<JSONObject>, onStop: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
        Text("BACKGROUND WORK", fontSize = 11.sp, color = Color.Gray, letterSpacing = 0.5.sp)
        tasks.forEach { t ->
            Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(t.optString("kind").uppercase(), fontSize = 11.sp, color = stateColor("working"))
                        Spacer(Modifier.width(8.dp))
                        Text(t.optString("title"), maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 14.sp)
                    }
                    if (t.optString("now").isNotEmpty()) Text(t.optString("now"), fontSize = 12.sp, color = Color.Gray, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                TextButton(onClick = { onStop(t.optString("id")) }) { Text("Stop", color = MaterialTheme.colorScheme.error) }
            }
        }
        HorizontalDivider(Modifier.padding(top = 6.dp), color = Color(0x22FFFFFF))
    }
}

// Running teams: the state word, each person with role word and state (tap opens the thread), the last posts, and
// Pause / Resume as in the desktop's Team view
@Composable
private fun TeamsScreen(onOpen: (String) -> Unit, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var teams by remember { mutableStateOf<List<JSONObject>?>(null) }
    var err by remember { mutableStateOf("") }
    BackHandler(onBack = onBack)
    val reload = rememberLoader(every = { 5000L }) {
        err = attempt("teams") { teams = objs(Relay.ask("teams").optJSONArray("teams")).distinctBy { it.optString("id") } }
    }
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("‹ Back") }
            Text("Teams", style = MaterialTheme.typography.titleLarge)
        }
        StatusLine()
        if (err.isNotEmpty()) Text(err, color = MaterialTheme.colorScheme.error)
        if (teams?.isEmpty() == true) Text("No team is running.", color = Color.Gray, modifier = Modifier.padding(top = 12.dp))
        LazyColumn(Modifier.fillMaxSize()) {
            items(teams ?: emptyList(), key = { it.optString("id") }) { t ->
                val word = t.optString("word")
                Column(Modifier.fillMaxWidth().padding(vertical = 12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(t.optString("name"), Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        StateWord(word)
                        Spacer(Modifier.width(8.dp))
                        val op = if (word == "PAUSED") "teamResume" else "teamPause"
                        OutlinedButton(onClick = { scope.launch { err = attempt { Relay.ask(op, mapOf("id" to t.optString("id"))) }; reload() } }) {
                            Text(if (word == "PAUSED") "Resume" else "Pause")
                        }
                    }
                    if (t.optString("goal").isNotEmpty()) Text(t.optString("goal"), fontSize = 12.sp, color = Color.Gray, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    objs(t.optJSONArray("members")).forEach { m ->
                        Row(Modifier.fillMaxWidth().clickable { onOpen(m.optString("open")) }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(m.optString("role").uppercase(), Modifier.width(96.dp), fontSize = 11.sp, color = Color.Gray, maxLines = 1)
                            Text(m.optString("name"), Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            StateWord(m.optString("state"))
                        }
                    }
                    val posts = objs(t.optJSONArray("posts"))
                    if (posts.isNotEmpty()) Text("LATEST POSTS", Modifier.padding(top = 8.dp), fontSize = 11.sp, color = Color.Gray, letterSpacing = 0.5.sp)
                    posts.forEach { p ->
                        Text("${p.optString("from")}: ${p.optString("text")}", Modifier.padding(top = 4.dp), fontSize = 12.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    }
                }
                HorizontalDivider(color = Color(0x22FFFFFF))
            }
        }
    }
}

// Every scheduled wake-up: a thread's own follow-ups and the threads waiting for a usage limit to reset
@Composable
private fun WakeupsScreen(onOpen: (String) -> Unit, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var rows by remember { mutableStateOf<List<JSONObject>?>(null) }
    var err by remember { mutableStateOf("") }
    BackHandler(onBack = onBack)
    val reload = rememberLoader {
        err = attempt("wake-ups") { rows = objs(Relay.ask("wakeups").optJSONArray("wakeups")).distinctBy { it.optString("kind") + ":" + it.optString("id") } }
    }
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("‹ Back") }
            Text("Wake-ups", style = MaterialTheme.typography.titleLarge)
        }
        StatusLine()
        if (err.isNotEmpty()) Text(err, color = MaterialTheme.colorScheme.error)
        if (rows?.isEmpty() == true) Text("Nothing is scheduled.", color = Color.Gray, modifier = Modifier.padding(top = 12.dp))
        LazyColumn(Modifier.fillMaxSize()) {
            items(rows ?: emptyList(), key = { it.optString("kind") + ":" + it.optString("id") }) { w ->
                Row(Modifier.fillMaxWidth().clickable { onOpen(w.optString("open")) }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(w.optString("title"), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
                        val every = if (w.isNull("every")) "" else ", then every ${w.optInt("every")} min"
                        Text(whenLabel(w.optLong("at"), full = true) + every, fontSize = 12.sp, color = stateColor("waiting"))
                        Text(w.optString("prompt"), fontSize = 12.sp, color = Color.Gray, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    TextButton(onClick = { scope.launch { err = attempt { Relay.ask("cancelWakeup", mapOf("kind" to w.optString("kind"), "id" to w.optString("id"))) }; reload() } }) {
                        Text("Cancel", color = MaterialTheme.colorScheme.error)
                    }
                }
                HorizontalDivider(color = Color(0x22FFFFFF))
            }
        }
    }
}

// Claude's multiple-choice question, as on the desktop: pick (or type under Other), then Submit; or reply in the chat
@Composable
private fun AskCard(ask: JSONObject, onAnswer: (JSONObject, (Boolean) -> Unit) -> Unit) {
    val qs = objs(ask.optJSONArray("questions"))
    if (qs.isEmpty()) return
    val picks = remember(ask.optString("id")) { mutableStateListOf<Set<String>>().apply { repeat(qs.size) { add(emptySet()) } } }
    val other = remember(ask.optString("id")) { mutableStateListOf<String>().apply { repeat(qs.size) { add("") } } }
    var sent by remember(ask.optString("id")) { mutableStateOf(false) }
    // question text -> answer (several picks comma-separated), or null while one is unanswered
    fun answers(): JSONObject? {
        val out = JSONObject()
        qs.forEachIndexed { i, q ->
            val multi = q.optBoolean("multiSelect")
            val typed = other[i].trim()
            val parts = if (multi) picks[i].toList() + listOfNotNull(typed.ifEmpty { null }) else if (typed.isNotEmpty()) listOf(typed) else picks[i].take(1)
            if (parts.isEmpty()) return null
            out.put(q.optString("question"), parts.joinToString(", "))
        }
        return out
    }
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp).background(Color(0xFF2A2418), RoundedCornerShape(10.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        qs.forEachIndexed { i, q ->
            val multi = q.optBoolean("multiSelect")
            if (q.optString("header").isNotEmpty()) Text(q.optString("header"), fontSize = 11.sp, color = Color.Gray)
            Text(q.optString("question"), style = MaterialTheme.typography.bodyLarge)
            objs(q.optJSONArray("options")).forEach { o ->
                val label = o.optString("label")
                val on = label in picks[i] && (multi || other[i].isBlank())
                Row(Modifier.fillMaxWidth().clickable {
                    picks[i] = if (multi) (if (label in picks[i]) picks[i] - label else picks[i] + label) else setOf(label)
                    if (!multi) other[i] = ""
                }.padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (multi) Checkbox(on, null) else RadioButton(on, null)
                    Column { Text(label); if (o.optString("description").isNotEmpty()) Text(o.optString("description"), fontSize = 12.sp, color = Color.Gray) }
                }
            }
            OutlinedTextField(other[i], { other[i] = it }, Modifier.fillMaxWidth(), placeholder = { Text("Other") }, singleLine = true)
        }
        val a = answers()
        Button(enabled = a != null && !sent, onClick = { sent = true; onAnswer(a!!) { ok -> if (!ok) sent = false } }) { Text(if (sent) "Sent" else "Submit") }
        Text("or reply in the chat", fontSize = 12.sp, color = Color.Gray)
    }
}
