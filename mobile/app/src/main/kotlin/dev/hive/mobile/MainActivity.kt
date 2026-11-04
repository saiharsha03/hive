package dev.hive.mobile

// The app: a fingerprint to open it, pairing (scan the QR Hive shows, or paste it), the threads, one thread (read,
// send, stop) and a new thread. Everything goes to Hive on the computer through the relay, sealed.
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
    // Android 13+ asks before an app may show notifications
    val notifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(Unit) { if (android.os.Build.VERSION.SDK_INT >= 33) notifications.launch(Manifest.permission.POST_NOTIFICATIONS) }
    val list = @Composable { Threads(onOpen = { newThread = false; openThread.value = it }, onNew = { newThread = true }, onUsage = { usage = true }, onUnpair = { Relay.disconnect(); Pairing.clear(ctx); paired = false }) }
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
                        newThread -> NewThread(onDone = { newThread = false })
                        openThread.value != null -> key(openThread.value) { ThreadScreen(openThread.value!!) { openThread.value = null } }
                        else -> Text("Pick a thread", Modifier.align(Alignment.Center), color = Color.Gray)
                    }
                }
            }
            usage -> UsageScreen(onBack = { usage = false })
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
private fun Threads(onOpen: (String) -> Unit, onNew: () -> Unit, onUsage: () -> Unit, onUnpair: () -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val state by Relay.state.collectAsState()
    val changed by Relay.changed.collectAsState()
    var rows by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var err by remember { mutableStateOf("") }
    var menu by remember { mutableStateOf(false) }
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
                    DropdownMenuItem(text = { Text("Usage") }, onClick = { menu = false; onUsage() })
                    DropdownMenuItem(text = { Text("Unpair this phone") }, onClick = { menu = false; onUnpair() })
                }
            }
        }
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

private val sectionOrder = listOf("watchers", "pinned", "waiting", "working", "recent")
private val sectionLabels = mapOf("watchers" to "Watchers", "pinned" to "Pinned", "waiting" to "Waiting for you", "working" to "Working", "recent" to "Recent")

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
    var draft by remember { mutableStateOf("") }
    var err by remember { mutableStateOf("") }
    var tick by remember { mutableStateOf(0) }
    val list = rememberLazyListState()
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
            items = (0 until a.length()).map { a.getJSONObject(it) }
            // Claude's open questions (an older Hive sends none)
            val q = t.optJSONArray("asks")
            asks = if (q == null) emptyList() else (0 until q.length()).map { q.getJSONObject(it) }
            ""
        }.getOrElse { it.message ?: "Failed" }
        if (items.isNotEmpty()) list.scrollToItem(items.size - 1 + asks.size)
    }
    // while Claude works, look again every few seconds
    LaunchedEffect(working) { while (working) { kotlinx.coroutines.delay(4000); tick++ } }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("‹ Back") }
            Text(title, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
            if (working) TextButton(onClick = { scope.launch { runCatching { Relay.ask("stop", mapOf("id" to id)) }; tick++ } }) { Text("Stop", color = MaterialTheme.colorScheme.error) }
        }
        Box(Modifier.padding(horizontal = 16.dp)) { StatusLine() }
        if (err.isNotEmpty()) Text(err, Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.error)
        LazyColumn(Modifier.weight(1f).padding(horizontal = 12.dp), state = list) {
            items(items) { it -> Item(it) }
            items(asks, key = { "ask:" + it.optString("id") }) { a ->
                AskCard(a) { answers ->
                    scope.launch { err = runCatching { Relay.ask("answer", mapOf("id" to id, "ask" to a.optString("id"), "answers" to answers)); tick++; "" }.getOrElse { it.message ?: "Failed" } }
                }
            }
            if (working && asks.isEmpty()) item { Text("Claude is working…", Modifier.padding(8.dp), color = Color(0xFF5BA8F0), fontSize = 13.sp) }
        }
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.Bottom) {
            OutlinedTextField(draft, { draft = it }, Modifier.weight(1f), placeholder = { Text(if (working) "Steer Claude…" else "Message Claude…") }, maxLines = 6)
            Spacer(Modifier.width(8.dp))
            Button(enabled = draft.isNotBlank() && state == Relay.State.Online, onClick = {
                val text = draft.trim(); draft = ""
                scope.launch { err = runCatching { Relay.ask("send", mapOf("id" to id, "text" to text)); working = true; tick++; "" }.getOrElse { it.message ?: "Failed" } }
            }) { Text("Send") }
        }
    }
}

@Composable
private fun Item(it: JSONObject) {
    val t = it.optString("t")
    when (it.optString("k")) {
        "you" -> Box(Modifier.fillMaxWidth().padding(vertical = 6.dp), contentAlignment = Alignment.CenterEnd) {
            Text(t, Modifier.background(Color(0xFF2A3140), RoundedCornerShape(12.dp)).padding(10.dp).widthIn(max = 320.dp))
        }
        "claude" -> Text(t, Modifier.padding(vertical = 6.dp))
        "tool" -> Text("› $t", Modifier.padding(vertical = 2.dp), fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = Color.Gray, maxLines = 2, overflow = TextOverflow.Ellipsis)
        else -> Text(t, Modifier.padding(vertical = 4.dp), fontSize = 12.sp, color = Color.Gray)
    }
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

// Claude's multiple-choice question, as on the desktop: pick (or type under Other), then Submit; or reply in the chat
@Composable
private fun AskCard(ask: JSONObject, onAnswer: (JSONObject) -> Unit) {
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
        Button(enabled = a != null && !sent, onClick = { sent = true; onAnswer(a!!) }) { Text(if (sent) "Sent" else "Submit") }
        Text("or reply in the chat", fontSize = 12.sp, color = Color.Gray)
    }
}
