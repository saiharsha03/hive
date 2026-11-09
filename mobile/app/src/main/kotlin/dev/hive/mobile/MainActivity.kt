package dev.hive.mobile

// The app: a fingerprint to open it, pairing (scan the QR Hive shows, or paste it), the threads, one thread (read,
// send, stop, its background work) and a new thread, the running teams, the wake-ups and usage. Everything goes to
// Hive on the computer through the relay, sealed.
import android.Manifest
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
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
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
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
import kotlinx.coroutines.launch
import org.json.JSONObject

class MainActivity : FragmentActivity() {
    private val unlocked = mutableStateOf(false)
    private val openThread = mutableStateOf<String?>(null)
    private var hiddenAt = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        openThread.value = intent.getStringExtra("thread")?.takeIf { it.isNotEmpty() }
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Color(0xFFFFC83D), background = Color(0xFF15161A), surface = Color(0xFF1D1F24))) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    if (!unlocked.value) Locked { unlock() } else App(openThread)
                }
            }
        }
        unlock()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra("thread")?.takeIf { it.isNotEmpty() }?.let { openThread.value = it }
    }

    // locked again after two minutes away
    override fun onStop() { super.onStop(); hiddenAt = SystemClock.elapsedRealtime() }
    override fun onStart() {
        super.onStart()
        if (unlocked.value && hiddenAt > 0 && SystemClock.elapsedRealtime() - hiddenAt > 120_000) { unlocked.value = false; unlock() }
        if (unlocked.value) Relay.connect(this)
    }

    private fun opened() {
        unlocked.value = true
        Relay.connect(this)
        if (Pairing.load(this) != null) Notes.registerPush(this)
    }

    // Android 10: the screen lock (PIN, pattern, password) through the system's own confirm screen
    private val screenLock = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        if (r.resultCode == RESULT_OK) opened()
    }

    @Suppress("DEPRECATION") // createConfirmDeviceCredentialIntent is the Android 10 way; newer ones use the prompt
    private fun useScreenLock() {
        val km = getSystemService(android.app.KeyguardManager::class.java)
        km.createConfirmDeviceCredentialIntent("Open Hive", null)?.let { screenLock.launch(it) }
    }

    private fun unlock() {
        val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = opened()
            // Android 10: no strong fingerprint enrolled, or "Use screen lock" pressed: the screen lock instead
            override fun onAuthenticationError(code: Int, msg: CharSequence) {
                if (android.os.Build.VERSION.SDK_INT < 30 && code != BiometricPrompt.ERROR_USER_CANCELED && code != BiometricPrompt.ERROR_CANCELED) useScreenLock()
            }
        })
        // a strong biometric, with the screen lock as fallback. Android 10 cannot combine the two in one prompt, so
        // there the prompt is the strong biometric alone and its button (or no fingerprint at all) opens the screen lock
        val info = BiometricPrompt.PromptInfo.Builder().setTitle("Open Hive")
        if (android.os.Build.VERSION.SDK_INT >= 30) info.setAllowedAuthenticators(BIOMETRIC_STRONG or DEVICE_CREDENTIAL)
        else info.setAllowedAuthenticators(BIOMETRIC_STRONG).setNegativeButtonText("Use screen lock")
        prompt.authenticate(info.build())
    }
}

@Composable
private fun Locked(onUnlock: () -> Unit) {
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text("Hive is locked", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(16.dp))
        Button(onClick = onUnlock) { Text("Unlock") }
    }
}

@Composable
private fun App(openThread: MutableState<String?>) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var paired by remember { mutableStateOf(Pairing.load(ctx) != null) }
    var newThread by remember { mutableStateOf(false) }
    var usage by remember { mutableStateOf(false) }
    var teams by remember { mutableStateOf(false) }
    var wakeups by remember { mutableStateOf(false) }
    // Android 13+ asks before an app may show notifications
    val notifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(Unit) { if (android.os.Build.VERSION.SDK_INT >= 33) notifications.launch(Manifest.permission.POST_NOTIFICATIONS) }
    // a thread opened from Teams or Wake-ups closes that screen
    val open = { id: String -> newThread = false; usage = false; teams = false; wakeups = false; openThread.value = id }
    val list = @Composable {
        Threads(onOpen = { newThread = false; openThread.value = it }, onNew = { newThread = true }, onUsage = { usage = true },
            onTeams = { teams = true; wakeups = false; usage = false }, onWakeups = { wakeups = true; teams = false; usage = false },
            onUnpair = { Relay.disconnect(); Pairing.clear(ctx); paired = false })
    }
    BoxWithConstraints(Modifier.fillMaxSize().systemBarsPadding().imePadding()) {
        val wide = maxWidth
        when {
            !paired -> PairScreen { paired = true; Relay.connect(ctx); Notes.registerPush(ctx) }
            // unfolded or a tablet: the threads on the left, the open thread (or a new one) on the right
            wide >= 600.dp -> Row(Modifier.fillMaxSize()) {
                Box(Modifier.width(minOf(360.dp, wide * 0.4f)).fillMaxHeight()) { list() }
                VerticalDivider(color = Color(0x22FFFFFF))
                Box(Modifier.weight(1f).fillMaxHeight()) {
                    when {
                        usage -> UsageScreen(onBack = { usage = false })
                        teams -> TeamsScreen(onOpen = open, onBack = { teams = false })
                        wakeups -> WakeupsScreen(onOpen = open, onBack = { wakeups = false })
                        newThread -> NewThread(onDone = { newThread = false })
                        openThread.value != null -> key(openThread.value) { ThreadScreen(openThread.value!!) { openThread.value = null } }
                        else -> Text("Pick a thread", Modifier.align(Alignment.Center), color = Color.Gray)
                    }
                }
            }
            usage -> UsageScreen(onBack = { usage = false })
            teams -> TeamsScreen(onOpen = open, onBack = { teams = false })
            wakeups -> WakeupsScreen(onOpen = open, onBack = { wakeups = false })
            newThread -> NewThread(onDone = { newThread = false })
            openThread.value != null -> ThreadScreen(openThread.value!!) { openThread.value = null }
            else -> list()
        }
    }
}

@Composable
private fun PairScreen(onPaired: () -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var text by remember { mutableStateOf("") }
    var err by remember { mutableStateOf("") }
    val take = { qr: String ->
        if (Pairing.parse(qr) == null) err = "That is not a Hive pairing code"
        else { Pairing.save(ctx, qr); onPaired() }
    }
    val scan = rememberLauncherForActivityResult(ScanContract()) { r -> r.contents?.let(take) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) scan.launch(ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE).setPrompt("Scan the code in Hive: Settings > General > Phone app").setBeepEnabled(false))
    }
    Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Pair with Hive", style = MaterialTheme.typography.headlineSmall)
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
    val (label, color) = when (s) {
        Relay.State.Online -> "Computer online" to Color(0xFF5BC27A)
        Relay.State.RelayOnly -> "Computer offline (Hive closed or asleep)" to Color(0xFFE0A030)
        Relay.State.Connecting -> "Connecting…" to Color.Gray
        Relay.State.Off -> "Not connected" to Color(0xFFE05050)
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(8.dp).background(color, RoundedCornerShape(4.dp)))
        Spacer(Modifier.width(8.dp))
        Text(label, fontSize = 13.sp, color = Color.Gray)
    }
}

@Composable
private fun Threads(onOpen: (String) -> Unit, onNew: () -> Unit, onUsage: () -> Unit, onTeams: () -> Unit, onWakeups: () -> Unit, onUnpair: () -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val state by Relay.state.collectAsState()
    val changed by Relay.changed.collectAsState()
    var rows by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var err by remember { mutableStateOf("") }
    var menu by remember { mutableStateOf(false) }
    var unpair by remember { mutableStateOf(false) }
    LaunchedEffect(state, changed) {
        if (state == Relay.State.Off) Relay.connect(ctx)
        if (state != Relay.State.Online) return@LaunchedEffect
        err = runCatching {
            val a = Relay.ask("threads").getJSONArray("threads")
            rows = (0 until a.length()).map { a.getJSONObject(it) }
            ""
        }.getOrElse { it.message ?: "Failed" }
    }
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Threads", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
            Button(onClick = onNew, enabled = state == Relay.State.Online) { Text("New") }
            Box {
                TextButton(onClick = { menu = true }) { Text("⋮", fontSize = 20.sp) }
                DropdownMenu(menu, { menu = false }) {
                    DropdownMenuItem(text = { Text("Teams") }, onClick = { menu = false; onTeams() })
                    DropdownMenuItem(text = { Text("Wake-ups") }, onClick = { menu = false; onWakeups() })
                    DropdownMenuItem(text = { Text("Usage") }, onClick = { menu = false; onUsage() })
                    DropdownMenuItem(text = { Text("Unpair this phone") }, onClick = { menu = false; unpair = true })
                }
            }
        }
        // unpairing means scanning a new code in Hive, so ask first
        if (unpair) AlertDialog(onDismissRequest = { unpair = false }, title = { Text("Unpair this phone?") },
            text = { Text("To use the app again you pair it anew in Hive on your computer.") },
            confirmButton = { TextButton(onClick = { unpair = false; onUnpair() }) { Text("Unpair", color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { unpair = false }) { Text("Cancel") } })
        StatusLine()
        if (err.isNotEmpty()) Text(err, color = MaterialTheme.colorScheme.error)
        LazyColumn(Modifier.fillMaxSize().padding(top = 8.dp)) {
            // Hive sends each thread's sidebar section, in order; an older Hive sends none, so the list stays flat
            sections(rows).forEach { (section, group) ->
            if (section.isNotEmpty()) item(key = "section:$section") {
                Text(sectionLabels[section] ?: section, style = MaterialTheme.typography.labelLarge, color = Color.Gray, modifier = Modifier.padding(top = 16.dp, bottom = 4.dp))
            }
            items(group, key = { it.getString("id") }) { t ->
                val st = t.optString("state")
                Column(Modifier.fillMaxWidth().clickable { onOpen(t.getString("id")) }.padding(vertical = 10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (st != "idle") Text(if (st == "working") "● " else "◆ ", color = if (st == "working") Color(0xFF5BA8F0) else Color(0xFFE0A030))
                        Text(t.optString("title"), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
                    }
                    Text(listOf(t.optString("folder"), t.optString("note")).filter { it.isNotEmpty() }.joinToString(" · "), fontSize = 12.sp, color = Color.Gray, maxLines = 1)
                }
                HorizontalDivider(color = Color(0x22FFFFFF))
            }
            }
        }
    }
}

private val sectionOrder = listOf("watchers", "pinned", "waiting", "working", "dependabot", "recent")
private val sectionLabels = mapOf("watchers" to "Watchers", "pinned" to "Pinned", "waiting" to "Waiting for you", "working" to "Working", "dependabot" to "Dependabot", "recent" to "Recent")

// rows grouped by section in the sidebar's order (an unknown section from a newer Hive goes last); "" = no sections
private fun sections(rows: List<JSONObject>): List<Pair<String, List<JSONObject>>> =
    rows.groupBy { it.optString("section") }.toList().sortedBy { (k, _) -> sectionOrder.indexOf(k).let { if (it < 0) sectionOrder.size else it } }

@Composable
private fun ThreadScreen(id: String, onBack: () -> Unit) {
    val state by Relay.state.collectAsState()
    val changed by Relay.changed.collectAsState()
    val scope = rememberCoroutineScope()
    var title by remember { mutableStateOf("") }
    var items by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var working by remember { mutableStateOf(false) }
    var asks by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var tasks by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var draft by remember { mutableStateOf("") }
    var err by remember { mutableStateOf("") }
    var tick by remember { mutableStateOf(0) }
    val list = rememberLazyListState()
    // follow the end on the first load, after a send, and while the reader is already at the bottom; not when scrolled up
    var follow by remember(id) { mutableStateOf(true) }
    androidx.activity.compose.BackHandler(onBack = onBack)
    val ctx = androidx.compose.ui.platform.LocalContext.current
    LaunchedEffect(id, state, changed, tick) {
        if (state == Relay.State.Off) Relay.connect(ctx) // the connection dropped while this thread was open
        if (state != Relay.State.Online) return@LaunchedEffect
        err = runCatching {
            val t = Relay.ask("thread", mapOf("id" to id)).optJSONObject("thread") ?: throw IllegalStateException("That thread is gone")
            title = t.optString("title")
            working = t.optBoolean("working")
            val a = t.getJSONArray("items")
            val seen = list.layoutInfo
            if ((seen.visibleItemsInfo.lastOrNull()?.index ?: -1) >= seen.totalItemsCount - 2) follow = true
            items = (0 until a.length()).map { a.getJSONObject(it) }
            // Claude's open questions (an older Hive sends none)
            val q = t.optJSONArray("asks")
            asks = if (q == null) emptyList() else (0 until q.length()).map { q.getJSONObject(it) }
            // its running background work (a 1.x Hive sends none)
            val b = t.optJSONArray("tasks")
            tasks = if (b == null) emptyList() else (0 until b.length()).map { b.getJSONObject(it) }
            ""
        }.getOrElse { it.message ?: "Failed" }
        if (follow && items.isNotEmpty()) list.scrollToItem(items.size - 1 + asks.size)
        follow = false
    }
    // while Claude or its background work runs, look again every few seconds
    val running = working || tasks.isNotEmpty()
    LaunchedEffect(running) { while (running) { kotlinx.coroutines.delay(4000); tick++ } }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("‹ Back") }
            Text(title, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
            if (working) TextButton(onClick = { scope.launch { runCatching { Relay.ask("stop", mapOf("id" to id)) }; tick++ } }) { Text("Stop", color = MaterialTheme.colorScheme.error) }
        }
        Box(Modifier.padding(horizontal = 16.dp)) { StatusLine() }
        if (err.isNotEmpty()) Text(err, Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.error)
        if (tasks.isNotEmpty()) BackgroundWork(tasks) { task -> scope.launch { err = runCatching { Relay.ask("stopTask", mapOf("id" to id, "task" to task)); tick++; "" }.getOrElse { it.message ?: "Failed" } } }
        LazyColumn(Modifier.weight(1f).padding(horizontal = 12.dp), state = list) {
            items(items) { it -> Item(it) }
            items(asks, key = { "ask:" + it.optString("id") }) { a ->
                AskCard(a) { answers, done ->
                    scope.launch {
                        err = runCatching { Relay.ask("answer", mapOf("id" to id, "ask" to a.optString("id"), "answers" to answers)); tick++; "" }.getOrElse { it.message ?: "Failed" }
                        done(err.isEmpty())
                    }
                }
            }
            if (working && asks.isEmpty()) item { Text("Claude is working…", Modifier.padding(8.dp), color = Color(0xFF5BA8F0), fontSize = 13.sp) }
        }
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.Bottom) {
            OutlinedTextField(draft, { draft = it }, Modifier.weight(1f), placeholder = { Text(if (working) "Steer Claude…" else "Message Claude…") }, maxLines = 6)
            Spacer(Modifier.width(8.dp))
            Button(enabled = draft.isNotBlank() && state == Relay.State.Online, onClick = {
                val text = draft.trim(); draft = ""; follow = true
                // a failed send puts the text back, unless something new was typed meanwhile
                scope.launch { err = runCatching { Relay.ask("send", mapOf("id" to id, "text" to text)); working = true; tick++; "" }.getOrElse { if (draft.isEmpty()) draft = text; it.message ?: "Failed" } }
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

@Composable
private fun NewThread(onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    var folders by remember { mutableStateOf<List<String>>(emptyList()) }
    var folder by remember { mutableStateOf("") }
    var text by remember { mutableStateOf("") }
    var err by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    androidx.activity.compose.BackHandler(onBack = onDone)
    LaunchedEffect(Unit) {
        runCatching {
            val a = Relay.ask("threads").optJSONArray("folders")
            folders = if (a == null) emptyList() else (0 until a.length()).map { a.getString(it) }
            folder = folders.firstOrNull() ?: ""
        }.onFailure { err = it.message ?: "Failed" }
    }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onDone) { Text("‹ Back") }
            Text("New thread", style = MaterialTheme.typography.titleLarge)
        }
        Text("Folder", color = Color.Gray, fontSize = 13.sp)
        LazyColumn(Modifier.heightIn(max = 220.dp)) {
            items(folders) { f ->
                Row(Modifier.fillMaxWidth().clickable { folder = f }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(selected = folder == f, onClick = { folder = f })
                    Text(f.substringAfterLast('\\').substringAfterLast('/'), maxLines = 1)
                }
            }
        }
        OutlinedTextField(text, { text = it }, Modifier.fillMaxWidth(), label = { Text("What should Claude do?") }, minLines = 4)
        Button(enabled = text.isNotBlank() && !busy, modifier = Modifier.fillMaxWidth(), onClick = {
            busy = true
            scope.launch {
                runCatching { Relay.ask("new", mapOf("folder" to folder, "text" to text.trim())) }
                    .onSuccess { onDone() }.onFailure { err = it.message ?: "Failed"; busy = false }
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
    val state by Relay.state.collectAsState()
    var plan by remember { mutableStateOf("") }
    var rows by remember { mutableStateOf<List<JSONObject>?>(null) }
    var err by remember { mutableStateOf("") }
    androidx.activity.compose.BackHandler(onBack = onBack)
    LaunchedEffect(state) {
        if (state != Relay.State.Online) return@LaunchedEffect
        runCatching {
            val u = Relay.ask("usage").getJSONObject("usage")
            plan = u.optString("plan").let { if (it == "null") "" else it }
            val a = u.getJSONArray("rows")
            rows = (0 until a.length()).map { a.getJSONObject(it) }
            err = ""
        }.onFailure { err = if (it.message?.contains("unknown", true) == true) "Update Hive on the computer to see usage" else it.message ?: "Failed" }
    }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("‹ Back") }
            Text(if (plan.isEmpty()) "Usage" else "Usage (${plan.replaceFirstChar { it.uppercase() }})", style = MaterialTheme.typography.titleLarge)
        }
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
private fun StateWord(word: String) = Text(word.uppercase(), fontSize = 11.sp, color = stateColor(word), fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold, letterSpacing = 0.5.sp)

// "3:41 PM", with the weekday when not today
private fun whenText(ms: Long): String {
    val t = java.time.Instant.ofEpochMilli(ms).atZone(java.time.ZoneId.systemDefault())
    val today = java.time.LocalDate.now() == t.toLocalDate()
    return t.format(java.time.format.DateTimeFormatter.ofPattern(if (today) "h:mm a" else "EEE MMM d, h:mm a"))
}

// an older Hive on the computer has no such request
private fun oldHive(e: Throwable, what: String): String = if (e.message?.contains("unknown", true) == true) "Update Hive on the computer to see $what" else e.message ?: "Failed"

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
    val state by Relay.state.collectAsState()
    val changed by Relay.changed.collectAsState()
    val scope = rememberCoroutineScope()
    var teams by remember { mutableStateOf<List<JSONObject>?>(null) }
    var err by remember { mutableStateOf("") }
    var tick by remember { mutableStateOf(0) }
    androidx.activity.compose.BackHandler(onBack = onBack)
    LaunchedEffect(state, changed, tick) {
        if (state != Relay.State.Online) return@LaunchedEffect
        runCatching {
            val a = Relay.ask("teams").getJSONArray("teams")
            teams = (0 until a.length()).map { a.getJSONObject(it) }
            err = ""
        }.onFailure { err = oldHive(it, "teams") }
    }
    LaunchedEffect(Unit) { while (true) { kotlinx.coroutines.delay(5000); tick++ } }
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("‹ Back") }
            Text("Teams", style = MaterialTheme.typography.titleLarge)
        }
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
                        OutlinedButton(onClick = { scope.launch { err = runCatching { Relay.ask(op, mapOf("id" to t.optString("id"))); tick++; "" }.getOrElse { it.message ?: "Failed" } } }) {
                            Text(if (word == "PAUSED") "Resume" else "Pause")
                        }
                    }
                    if (t.optString("goal").isNotEmpty()) Text(t.optString("goal"), fontSize = 12.sp, color = Color.Gray, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    val ms = t.optJSONArray("members")
                    for (i in 0 until (ms?.length() ?: 0)) {
                        val m = ms!!.getJSONObject(i)
                        Row(Modifier.fillMaxWidth().clickable { onOpen(m.optString("open")) }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(m.optString("role").uppercase(), Modifier.width(96.dp), fontSize = 11.sp, color = Color.Gray, maxLines = 1)
                            Text(m.optString("name"), Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            StateWord(m.optString("state"))
                        }
                    }
                    val ps = t.optJSONArray("posts")
                    if ((ps?.length() ?: 0) > 0) Text("LATEST POSTS", Modifier.padding(top = 8.dp), fontSize = 11.sp, color = Color.Gray, letterSpacing = 0.5.sp)
                    for (i in 0 until (ps?.length() ?: 0)) {
                        val p = ps!!.getJSONObject(i)
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
    val state by Relay.state.collectAsState()
    val changed by Relay.changed.collectAsState()
    val scope = rememberCoroutineScope()
    var rows by remember { mutableStateOf<List<JSONObject>?>(null) }
    var err by remember { mutableStateOf("") }
    var tick by remember { mutableStateOf(0) }
    androidx.activity.compose.BackHandler(onBack = onBack)
    LaunchedEffect(state, changed, tick) {
        if (state != Relay.State.Online) return@LaunchedEffect
        runCatching {
            val a = Relay.ask("wakeups").getJSONArray("wakeups")
            rows = (0 until a.length()).map { a.getJSONObject(it) }
            err = ""
        }.onFailure { err = oldHive(it, "wake-ups") }
    }
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("‹ Back") }
            Text("Wake-ups", style = MaterialTheme.typography.titleLarge)
        }
        if (err.isNotEmpty()) Text(err, color = MaterialTheme.colorScheme.error)
        if (rows?.isEmpty() == true) Text("Nothing is scheduled.", color = Color.Gray, modifier = Modifier.padding(top = 12.dp))
        LazyColumn(Modifier.fillMaxSize()) {
            items(rows ?: emptyList(), key = { it.optString("kind") + it.optString("id") }) { w ->
                Row(Modifier.fillMaxWidth().clickable { onOpen(w.optString("open")) }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(w.optString("title"), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
                        val every = if (w.isNull("every")) "" else ", then every ${w.optInt("every")} min"
                        Text(whenText(w.optLong("at")) + every, fontSize = 12.sp, color = stateColor("waiting"))
                        Text(w.optString("prompt"), fontSize = 12.sp, color = Color.Gray, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    TextButton(onClick = { scope.launch { err = runCatching { Relay.ask("cancelWakeup", mapOf("kind" to w.optString("kind"), "id" to w.optString("id"))); tick++; "" }.getOrElse { it.message ?: "Failed" } } }) {
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
    val qa = ask.optJSONArray("questions") ?: return
    val qs = (0 until qa.length()).map { qa.getJSONObject(it) }
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
            val opts = q.optJSONArray("options")
            for (j in 0 until (opts?.length() ?: 0)) {
                val o = opts!!.getJSONObject(j); val label = o.optString("label")
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
