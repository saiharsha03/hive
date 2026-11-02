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

    private fun unlock() {
        val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                unlocked.value = true
                Relay.connect(this@MainActivity)
                if (Pairing.load(this@MainActivity) != null) Notes.registerPush(this@MainActivity)
            }
        })
        prompt.authenticate(BiometricPrompt.PromptInfo.Builder().setTitle("Open Hive").setAllowedAuthenticators(BIOMETRIC_STRONG or DEVICE_CREDENTIAL).build())
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
    // Android 13+ asks before an app may show notifications
    val notifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(Unit) { if (android.os.Build.VERSION.SDK_INT >= 33) notifications.launch(Manifest.permission.POST_NOTIFICATIONS) }
    Box(Modifier.fillMaxSize().systemBarsPadding().imePadding()) {
        when {
            !paired -> PairScreen { paired = true; Relay.connect(ctx); Notes.registerPush(ctx) }
            newThread -> NewThread(onDone = { newThread = false })
            openThread.value != null -> ThreadScreen(openThread.value!!) { openThread.value = null }
            else -> Threads(onOpen = { openThread.value = it }, onNew = { newThread = true }, onUnpair = { Relay.disconnect(); Pairing.clear(ctx); paired = false })
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
private fun Threads(onOpen: (String) -> Unit, onNew: () -> Unit, onUnpair: () -> Unit) {
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
                DropdownMenu(menu, { menu = false }) { DropdownMenuItem(text = { Text("Unpair this phone") }, onClick = { menu = false; onUnpair() }) }
            }
        }
        StatusLine()
        if (err.isNotEmpty()) Text(err, color = MaterialTheme.colorScheme.error)
        LazyColumn(Modifier.fillMaxSize().padding(top = 8.dp)) {
            items(rows, key = { it.getString("id") }) { t ->
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

@Composable
private fun ThreadScreen(id: String, onBack: () -> Unit) {
    val state by Relay.state.collectAsState()
    val changed by Relay.changed.collectAsState()
    val scope = rememberCoroutineScope()
    var title by remember { mutableStateOf("") }
    var items by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var working by remember { mutableStateOf(false) }
    var draft by remember { mutableStateOf("") }
    var err by remember { mutableStateOf("") }
    var tick by remember { mutableStateOf(0) }
    val list = rememberLazyListState()
    androidx.activity.compose.BackHandler(onBack = onBack)
    LaunchedEffect(id, state, changed, tick) {
        if (state != Relay.State.Online) return@LaunchedEffect
        err = runCatching {
            val t = Relay.ask("thread", mapOf("id" to id)).optJSONObject("thread") ?: throw IllegalStateException("That thread is gone")
            title = t.optString("title")
            working = t.optBoolean("working")
            val a = t.getJSONArray("items")
            items = (0 until a.length()).map { a.getJSONObject(it) }
            ""
        }.getOrElse { it.message ?: "Failed" }
        if (items.isNotEmpty()) list.scrollToItem(items.size - 1)
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
            if (working) item { Text("Claude is working…", Modifier.padding(8.dp), color = Color(0xFF5BA8F0), fontSize = 13.sp) }
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
