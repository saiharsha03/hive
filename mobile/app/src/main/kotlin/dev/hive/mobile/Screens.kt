package dev.hive.mobile

// Every screen, drawn from plain values and callbacks: nothing here talks to Hive, so the same code is what the
// app shows and what the screenshot tests render (src/test, ScreensTest). MainActivity.kt wires them to the relay.
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mikepenz.markdown.m3.Markdown
import com.mikepenz.markdown.m3.markdownColor
import com.mikepenz.markdown.m3.markdownTypography
import org.json.JSONObject

// ---------------------------------------------------------------- Needs me

// What needs the user, each with its one or two direct actions, then what is coming up.
// right: a word for the head (the account and its 5-hour use, when Hive says). busy: the thread an action is running for.
@Composable
fun InboxScreen(
    box: Inbox, now: Long, right: String = "", notice: String = "", busy: String = "", loaded: Boolean = true,
    onAnswer: (Need, String) -> Unit = { _, _ -> }, onOpen: (String) -> Unit = {}, onRetry: (Need) -> Unit = {}, onDismiss: (Need) -> Unit = {},
) {
    Column(Modifier.fillMaxSize()) {
        Head("Needs me", count = if (box.needs.isEmpty()) "" else box.needs.size.toString(), right = right)
        Notice(notice)
        LazyColumn(Modifier.fillMaxSize()) {
            if (box.needs.isEmpty() && loaded) item { Empty("Nothing needs you right now."); Rule() }
            itemsIndexed(box.needs, key = { _, n -> n.kind + ":" + n.thread }) { i, n ->
                val failed = n.kind == "failed"
                ListRow(n.title, meta = Words.age(n.at, now), word = if (failed) "FAILED" else "WAITING", note = n.note, on = i == 0, onClick = { onOpen(n.thread) }) {
                    val free = busy != n.thread
                    // a question one tap can answer: its first two choices, then Open for the rest
                    n.options.take(2).forEach { o -> Act(o, enabled = free) { onAnswer(n, o) } }
                    if (failed) Act("Retry", enabled = free) { onRetry(n) }
                    Act("Open", C.dim) { onOpen(n.thread) }
                    if (failed) Act("Dismiss", C.dim, enabled = free) { onDismiss(n) }
                }
            }
            if (box.coming.isNotEmpty()) item { Group("Coming up", box.counts.scheduled.takeIf { it > 0 }?.toString() ?: "") }
            items(box.coming, key = { "wake:" + it.kind + ":" + it.id }) { w ->
                ListRow(w.title, meta = Words.clock(w.at, now), word = Words.wakeWord(w), note = "in ${Words.until(w.at, now)}" + if (w.prompt.isNotEmpty()) ", ${w.prompt}" else "", onClick = { onOpen(w.open) })
            }
        }
    }
}

// ---------------------------------------------------------------- Threads

private val sectionOrder = listOf("waiting", "working", "watchers", "pinned", "dependabot", "recent")
private val sectionNames = mapOf("watchers" to "Watchers", "pinned" to "Pinned", "waiting" to "Needs you", "working" to "Working", "dependabot" to "Dependabot", "recent" to "Recent")

@Composable
fun ThreadsScreen(
    rows: List<ThreadRow>, now: Long, query: String = "", drafts: Set<String> = emptySet(), open: String = "", notice: String = "", canNew: Boolean = true,
    onQuery: (String) -> Unit = {}, onOpen: (String) -> Unit = {}, onNew: () -> Unit = {},
) {
    val q = query.trim()
    val shown = if (q.isEmpty()) rows else rows.filter { it.title.contains(q, true) || it.folder.contains(q, true) }
    // Hive sends each thread's section; an older Hive sends none, so the list stays flat
    val groups = shown.groupBy { it.section }.toList().sortedBy { (k, _) -> sectionOrder.indexOf(k).let { if (it < 0) sectionOrder.size else it } }
    Column(Modifier.fillMaxSize()) {
        Head("Threads", count = rows.size.takeIf { it > 0 }?.toString() ?: "", right = "New thread", rightColor = if (canNew) C.link else C.faint, onRight = if (canNew) onNew else null)
        Notice(notice)
        UnderlineInput(query, onQuery, "Search threads", Modifier.padding(horizontal = Pad), maxLines = 1, rule = C.rule2)
        LazyColumn(Modifier.fillMaxSize()) {
            groups.forEach { (section, group) ->
                if (section.isNotEmpty()) item(key = "section:$section") { Group(sectionNames[section] ?: section, group.size.toString(), if (section == "waiting") C.wait else C.dim) }
                items(group, key = { "thread:" + it.id }) { t ->
                    // a thread stopped by a usage limit is PAUSED until its auto-continue; that is not a failure
                    val word = when { t.state == "working" -> "WORKING"; t.state == "waiting" -> "WAITING"; t.continues > 0 -> "PAUSED"; else -> "" }
                    // a pending wake-up or auto-continue takes the place of the age
                    val due = when { t.continues > 0 -> "CONTINUES " + Words.clock(t.continues, now); t.wakes > 0 -> "WAKES " + Words.clock(t.wakes, now); else -> "" }
                    // what it is doing now, else where it lives; a thread with unsent text says so
                    val about = listOf(if (t.id in drafts) "Draft kept" else "", t.note.ifEmpty { t.folder }).filter { it.isNotEmpty() }.joinToString(", ")
                    ListRow(t.title, meta = Words.age(t.updated, now), word = word, note = about, on = t.id == open, metaWord = due, metaColor = if (t.continues > 0) C.hold else C.hi, onClick = { onOpen(t.id) })
                }
            }
            if (shown.isEmpty()) item { Empty(if (rows.isEmpty()) "No threads yet." else "No thread matches.") }
        }
    }
}

// ---------------------------------------------------------------- one thread

@Composable
private fun ItemRow(it: Item) {
    when (it.k) {
        // your own message: a band across the pane, a little heavier; whether Claude has taken it in, when Hive says
        "you" -> Box(Modifier.fillMaxWidth().padding(start = 56.dp, end = Pad, top = 6.dp, bottom = 6.dp), contentAlignment = Alignment.CenterEnd) {
            Column(Modifier.background(C.sel, androidx.compose.foundation.shape.RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp, bottomStart = 12.dp, bottomEnd = 2.dp)).padding(horizontal = 12.dp, vertical = 8.dp), horizontalAlignment = Alignment.End) {
                SelectionContainer { Text(it.t, style = T.conv.copy(color = C.hi)) }
                if (it.seen != null) StateWord(if (it.seen) "SEEN BY CLAUDE" else "NOT READ YET", Modifier.padding(top = 4.dp))
            }
        }
        "claude" -> SelectionContainer {
            val code = T.mono.copy(color = C.hi, fontSize = 12.5.sp, lineHeight = 19.sp)
            Markdown(it.t, modifier = Modifier.padding(horizontal = Pad, vertical = 6.dp),
                colors = markdownColor(text = C.ink, linkText = C.link, codeBackground = C.side, inlineCodeBackground = C.side, dividerColor = C.rule),
                typography = markdownTypography(h1 = T.sub, h2 = T.title.copy(fontWeight = FontWeight.SemiBold), h3 = T.title, h4 = T.title, h5 = T.title, h6 = T.title,
                    text = T.conv, paragraph = T.conv, ordered = T.conv, bullet = T.conv, list = T.conv, quote = T.conv.copy(color = C.dim), code = code, inlineCode = code))
        }
        // a tool row: the tool's name in the working colour, then what it ran, in mono
        "tool" -> Row(Modifier.padding(horizontal = Pad, vertical = 2.dp)) {
            Text(it.t.substringBefore(' '), Modifier.width(74.dp), style = T.mono.copy(color = C.work), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(it.t.substringAfter(' ', ""), style = T.mono.copy(color = C.dim), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        else -> Text(it.t, Modifier.padding(horizontal = Pad, vertical = 4.dp), style = T.label)
    }
}

// Claude's question, as a raised zone under an amber rule: numbered choices (the picked one takes the selection
// fill and bar), a line for something else, and Send answer.
@Composable
fun AskCard(ask: Ask, sent: Boolean = false, onAnswer: (JSONObject) -> Unit = {}) {
    val picks = remember(ask.id) { mutableStateListOf<Set<String>>().apply { repeat(ask.questions.size) { add(emptySet()) } } }
    val other = remember(ask.id) { mutableStateListOf<String>().apply { repeat(ask.questions.size) { add("") } } }
    // question text -> answer (several picks comma-separated), or null while one is unanswered
    fun answers(): JSONObject? {
        val out = JSONObject()
        ask.questions.forEachIndexed { i, q ->
            val typed = other[i].trim()
            val parts = if (q.multi) picks[i].toList() + listOfNotNull(typed.ifEmpty { null }) else if (typed.isNotEmpty()) listOf(typed) else picks[i].take(1)
            if (parts.isEmpty()) return null
            out.put(q.question, parts.joinToString(", "))
        }
        return out
    }
    Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp).background(C.raised).drawBehind { drawRect(C.wait, Offset.Zero, Size(size.width, 2.dp.toPx())) }) {
        ask.questions.forEachIndexed { i, q ->
            if (q.header.isNotEmpty()) Text(q.header, Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp), style = T.label)
            Text(q.question, Modifier.padding(start = 16.dp, end = 16.dp, top = if (q.header.isEmpty()) 12.dp else 2.dp, bottom = 10.dp), style = T.title.copy(fontWeight = FontWeight.SemiBold))
            q.options.forEachIndexed { j, o ->
                val on = o.label in picks[i] && (q.multi || other[i].isBlank())
                Rule()
                Row(Modifier.fillMaxWidth().clickable(enabled = !sent) {
                    picks[i] = if (q.multi) (if (o.label in picks[i]) picks[i] - o.label else picks[i] + o.label) else setOf(o.label)
                    if (!q.multi) other[i] = ""
                }.selected(on).padding(horizontal = 16.dp, vertical = 9.dp)) {
                    Text((j + 1).toString(), Modifier.width(26.dp).padding(top = 2.dp), style = T.mono)
                    Column {
                        Text(o.label, style = T.body.copy(color = if (on) C.hi else C.ink, fontWeight = if (on) FontWeight.Medium else FontWeight.Normal))
                        if (o.description.isNotEmpty()) Text(o.description, style = T.note.copy(fontSize = 12.5.sp))
                    }
                }
            }
            Rule()
            UnderlineInput(other[i], { other[i] = it }, if (q.multi) "And something else" else "Something else", Modifier.padding(horizontal = 16.dp), maxLines = 3, rule = C.rule2)
        }
        val a = answers()
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(if (sent) "Sent to Claude" else "or reply below", Modifier.weight(1f), style = T.label)
            Btn(if (sent) "Sent" else "Send answer", primary = true, enabled = a != null && !sent) { a?.let(onAnswer) }
        }
    }
}

// the composer: an underlined input with Mic beside it, and under it what Send will do and that the draft is kept
@Composable
fun Composer(draft: String, working: Boolean, canSend: Boolean, placeholder: String = "Message Claude", mic: Boolean = true, onDraft: (String) -> Unit = {}, onSend: () -> Unit = {}, onMic: () -> Unit = {}, onQueue: (() -> Unit)? = null, onInterrupt: (() -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().background(C.side)) {
        Rule()
        Column(Modifier.padding(start = 14.dp, end = 14.dp, top = 8.dp, bottom = 10.dp)) {
            UnderlineInput(draft, onDraft, placeholder, trailing = if (mic) ({ BoxWord("Mic", onClick = onMic) }) else null)
            Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(if (working) "Steers Claude" else "Starts a turn", style = T.label)
                if (draft.isNotBlank()) Text("Draft kept", style = T.label)
                Spacer(Modifier.weight(1f))
                val ok = canSend && draft.isNotBlank()
                if (working && onQueue != null) Text("Queue", Modifier.clickable(enabled = ok, onClick = onQueue).padding(horizontal = 6.dp, vertical = 2.dp), style = T.label.copy(fontSize = 13.sp), color = if (ok) C.link else C.faint)
                if (working && onInterrupt != null) Text("Interrupt", Modifier.clickable(enabled = ok, onClick = onInterrupt).padding(horizontal = 6.dp, vertical = 2.dp), style = T.label.copy(fontSize = 13.sp), color = if (ok) C.fail else C.faint)
                Text(if (working) "Steer" else "Send", Modifier.clickable(enabled = canSend && draft.isNotBlank(), onClick = onSend).padding(start = 12.dp, top = 2.dp, bottom = 2.dp),
                    style = T.label.copy(fontWeight = FontWeight.SemiBold, fontSize = 13.sp), color = if (canSend && draft.isNotBlank()) C.accent else C.faint)
            }
        }
    }
}

// error: what the last request failed with. leaving: Back was pressed with unsent text. sentAsks: answered here already.
@Composable
fun ThreadScreen(
    v: ThreadView, draft: String = "", online: Boolean = true, loaded: Boolean = true, error: String = "", notice: String = "", leaving: Boolean = false, sentAsks: Set<String> = emptySet(),
    list: LazyListState = rememberLazyListState(),
    onBack: () -> Unit = {}, onStay: () -> Unit = {}, onLeave: () -> Unit = {}, onDraft: (String) -> Unit = {}, onSend: () -> Unit = {}, onQuick: (Quick.Reply) -> Unit = {},
    onStop: () -> Unit = {}, onStopTask: (Task) -> Unit = {}, onAnswer: (Ask, JSONObject) -> Unit = { _, _ -> }, onMic: () -> Unit = {},
    settings: ThreadSettings? = null, settingsOpen: String = "", onSettingsOpen: (String) -> Unit = {}, onSetting: (String, String) -> Unit = { _, _ -> },
    onQueue: (() -> Unit)? = null, onInterrupt: (() -> Unit)? = null,
    more: ThreadMore? = null, morePane: String = "", now: Long = 0, rewinding: String = "", onMorePane: (String) -> Unit = {}, onRewind: (Point) -> Unit = {},
    onChanges: (() -> Unit)? = null,
) {
    Column(Modifier.fillMaxSize()) {
        Head(v.title.ifEmpty { if (loaded) "Thread" else "Opening" }, sub = true, onBack = onBack, right = if (v.working) "Stop" else "", rightColor = C.fail, onRight = onStop)
        Notice(notice)
        Notice(error)
        if (more != null) ThreadMoreBar(more, morePane, now, online, rewinding, onMorePane, onRewind, onChanges)
        if (leaving) ConfirmBar("Leave without sending?", "What you typed has not been sent. It is kept as a draft in this thread.", "Leave", cancel = "Stay", onCancel = onStay, onConfirm = onLeave)
        // the thread's running subagents, shells, workflows and Codex runs with their live line; Stop ends one
        if (v.tasks.isNotEmpty()) {
            Group("Running in this thread", v.tasks.size.toString())
            v.tasks.forEach { t ->
                Row(Modifier.fillMaxWidth().padding(horizontal = Pad, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Row { StateWord("WORKING", Modifier.padding(end = 6.dp, top = 3.dp)); Text("${t.kind}, ${t.title}", style = T.note, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                        if (t.now.isNotEmpty()) Text(t.now, style = T.mono.copy(color = C.dim), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Act("Stop", C.fail) { onStopTask(t) }
                }
            }
            Rule()
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = list) {
            items(v.items) { ItemRow(it) }
            items(v.asks, key = { "ask:" + it.id }) { a -> AskCard(a, sent = a.id in sentAsks) { onAnswer(a, it) } }
            if (v.working && v.asks.isEmpty()) item { Row(Modifier.padding(horizontal = Pad, vertical = 10.dp)) { StateWord("WORKING", Modifier.padding(end = 6.dp, top = 3.dp)); Text("Claude is on it", style = T.note) } }
            if (v.items.isEmpty() && v.asks.isEmpty() && loaded && !v.working) item { Empty("Nothing in this thread yet.") }
        }
        // quick replies: one tap sends them; the last cell stops the turn
        val quick = Quick.all
        Rule()
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
            quick.forEach { r ->
                Text(r.label, Modifier.weight(1f).clickable(enabled = online) { onQuick(r) }.padding(horizontal = 4.dp, vertical = 9.dp), style = T.action, color = if (online) C.link else C.faint, textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Box(Modifier.width(1.dp).fillMaxHeight().background(C.rule))
            }
            Text("Stop", Modifier.weight(1f).clickable(enabled = v.working, onClick = onStop).padding(vertical = 9.dp), style = T.action, color = if (v.working) C.fail else C.faint, textAlign = TextAlign.Center)
        }
        if (settings != null) ThreadSettingsBar(settings, settingsOpen, onSettingsOpen, onSetting)
        Composer(draft, v.working, online, if (v.working) "Steer Claude" else "Message Claude", onDraft = onDraft, onSend = onSend, onMic = onMic, onQueue = onQueue, onInterrupt = onInterrupt)
    }
}

// ---------------------------------------------------------------- Running

// stopAll: null = no question open; else whether "also pause wake-ups" is switched on. canPause: Hive can do that.
@Composable
fun RunningScreen(
    rows: List<RunRow>, notice: String = "", busy: Set<String> = emptySet(), stopAll: Boolean? = null, canPause: Boolean = false, threads: Int = 0, scheduled: Int = 0, loaded: Boolean = true,
    onStop: (RunRow) -> Unit = {}, onOpen: (String) -> Unit = {}, onAskStopAll: () -> Unit = {}, onPause: (Boolean) -> Unit = {}, onCancelStopAll: () -> Unit = {}, onStopAll: () -> Unit = {},
) {
    Column(Modifier.fillMaxSize()) {
        Head("Running", count = rows.size.takeIf { it > 0 }?.toString() ?: "", right = "Stop all", rightColor = if (rows.isEmpty() && threads == 0) C.faint else C.fail, onRight = onAskStopAll)
        Notice(notice)
        if (stopAll != null) StopAllBar(threads, rows.size, scheduled, stopAll, canPause, onPause, onCancelStopAll, onStopAll)
        LazyColumn(Modifier.fillMaxSize()) {
            if (rows.isEmpty() && loaded) item { Empty("No background work is running.") }
            items(rows, key = { it.thread + ":" + it.id }) { r ->
                val failed = r.state == "failed"
                ListRow(r.title, word = if (failed) "FAILED" else "WORKING", note = listOf(r.kind, r.threadTitle).filter { it.isNotEmpty() }.joinToString(", "), detail = r.now, onClick = { onOpen(r.thread) }) {
                    if (!failed && r.id.isNotEmpty()) Act("Stop", C.fail, enabled = (r.thread + ":" + r.id) !in busy) { onStop(r) }
                    Act("Open thread", C.dim) { onOpen(r.thread) }
                }
            }
        }
    }
}

// "Stop everything?" with what it will and will not do, said before it does it
@Composable
fun StopAllBar(threads: Int, tasks: Int, scheduled: Int, pause: Boolean, canPause: Boolean, onPause: (Boolean) -> Unit, onCancel: () -> Unit, onConfirm: () -> Unit) {
    ConfirmBar(
        "Stop everything?",
        "Interrupts ${Words.plural(threads, "working thread")} and stops ${Words.plural(tasks, "background task")}. " + if (canPause) "Wake-ups stay scheduled unless you switch this on." else "Wake-ups stay scheduled.",
        "Stop everything", danger = true, onCancel = onCancel, onConfirm = onConfirm,
        extra = if (!canPause) null else ({
            Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Also pause wake-ups and loops", style = T.body.copy(fontWeight = FontWeight.Medium, color = C.hi))
                    Text("$scheduled scheduled", style = T.note.copy(fontSize = 12.5.sp))
                }
                Toggle(pause, onPause)
            }
        }),
    )
}

// ---------------------------------------------------------------- Scheduled

// confirm: the wake-up ("kind:id") whose Cancel is waiting for a yes
@Composable
fun ScheduledScreen(
    wakes: List<Wake>, now: Long, canRun: Boolean = false, notice: String = "", busy: Set<String> = emptySet(), loaded: Boolean = true,
    onRun: (Wake) -> Unit = {}, onCancel: (Wake) -> Unit = {}, onOpen: (String) -> Unit = {},
) {
    Column(Modifier.fillMaxSize()) {
        Head("Scheduled", count = wakes.size.takeIf { it > 0 }?.toString() ?: "")
        Notice(notice)
        LazyColumn(Modifier.fillMaxSize()) {
            if (wakes.isEmpty() && loaded) item { Empty("Nothing is scheduled.") }
            items(wakes, key = { it.kind + ":" + it.id }) { w ->
                val free = (w.kind + ":" + w.id) !in busy
                Column(Modifier.fillMaxWidth().clickable { onOpen(w.open) }.padding(horizontal = Pad, vertical = 10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(Words.clock(w.at, now), Modifier.weight(1f), style = T.title.copy(fontWeight = FontWeight.SemiBold, fontSize = 16.sp))
                        StateWord(Words.wakeWord(w))
                    }
                    Text(w.prompt.ifEmpty { "Continue" }, Modifier.padding(top = 2.dp), style = T.body.copy(fontSize = 13.5.sp), maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(w.title + ", " + (if (w.every != null) "every ${w.every} min" else "once") + ", in ${Words.until(w.at, now)}", Modifier.padding(top = 2.dp), style = T.note.copy(color = C.faint), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Row(Modifier.padding(top = 7.dp), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                        if (canRun) Act("Run now", enabled = free) { onRun(w) }
                        Act("Cancel", C.fail, enabled = free) { onCancel(w) }
                    }
                }
                Rule()
            }
        }
    }
}

// ---------------------------------------------------------------- More

@Composable
private fun MoreRow(name: String, color: Color = C.hi, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = Pad, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(name, Modifier.weight(1f), style = T.title, color = color)
        Text("›", style = T.mono)
    }
    Rule()
}

@Composable
fun MoreScreen(
    notice: String = "", stopAll: Boolean? = null, canPause: Boolean = false, threads: Int = 0, tasks: Int = 0, scheduled: Int = 0, done: String = "", accounts: Boolean = false,
    onAskStopAll: () -> Unit = {}, onPause: (Boolean) -> Unit = {}, onCancelStopAll: () -> Unit = {}, onStopAll: () -> Unit = {},
    onUsage: () -> Unit = {}, onTeams: () -> Unit = {}, onNew: () -> Unit = {}, onSettings: () -> Unit = {},
    onNotes: (() -> Unit)? = null, onTodos: (() -> Unit)? = null, onWatchers: (() -> Unit)? = null,
) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Head("More")
        Notice(notice)
        Notice(done, C.done)
        if (stopAll != null) StopAllBar(threads, tasks, scheduled, stopAll, canPause, onPause, onCancelStopAll, onStopAll)
        else MoreRow("Stop everything", C.fail, onAskStopAll)
        MoreRow(if (accounts) "Usage and accounts" else "Usage", onClick = onUsage)
        if (onNotes != null) MoreRow("Notes", onClick = onNotes)
        if (onTodos != null) MoreRow("To do", onClick = onTodos)
        if (onWatchers != null) MoreRow("Watchers", onClick = onWatchers)
        MoreRow("Teams", onClick = onTeams)
        MoreRow("New thread", onClick = onNew)
        MoreRow("Settings", onClick = onSettings)
    }
}

// ---------------------------------------------------------------- Usage and accounts

// accounts: null when this Hive has no account profiles (the zone is left out). switching: the account asked about.
@Composable
fun UsageScreen(
    limits: List<Limit>?, now: Long, plan: String = "", accounts: List<Account>? = null, notice: String = "", error: String = "", switching: Account? = null, busy: Boolean = false,
    working: Int = 0, wakes: List<Wake> = emptyList(),
    onBack: () -> Unit = {}, onPick: (Account) -> Unit = {}, onCancelSwitch: () -> Unit = {}, onSwitch: (Account) -> Unit = {},
) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Head("Usage", onBack = onBack, right = plan)
        Notice(notice)
        Notice(error)
        if (limits != null && limits.isEmpty()) { Empty("No reading yet."); Rule() }
        // the usage guard: a calm band with an amber rule at the left when a window is close to its limit
        Usage.guard(limits ?: emptyList(), now)?.let { g ->
            Column(Modifier.fillMaxWidth().background(C.raised).drawBehind { drawRect(C.wait, Offset.Zero, Size(3.dp.toPx(), size.height)) }.padding(horizontal = Pad, vertical = 10.dp)) {
                StateWord("USAGE GUARD", color = C.wait)
                Text(Usage.guardWords(g, now, working, wakes), Modifier.padding(top = 4.dp), style = T.note.copy(color = C.hi))
            }
            Rule()
        }
        limits?.forEach { l ->
            val warn = l.pct >= 60
            Column(Modifier.fillMaxWidth().padding(horizontal = Pad, vertical = 10.dp)) {
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(l.label, Modifier.weight(1f).alignByBaseline(), style = T.body.copy(color = C.hi))
                    Text("${l.pct.toInt()}%", Modifier.alignByBaseline(), style = T.page.copy(fontSize = 22.sp, fontWeight = FontWeight.SemiBold), color = if (warn) C.wait else C.hi)
                }
                Box(Modifier.padding(top = 6.dp, bottom = 4.dp)) { Meter((l.pct / 100).toFloat(), if (warn) C.wait else C.ink) }
                val resets = Usage.resets(l, now)
                if (resets.isNotEmpty()) Text(resets, style = T.note.copy(fontSize = 12.5.sp))
                val ahead = Usage.forecast(l, now)
                if (ahead.isNotEmpty()) Text(ahead, style = T.note.copy(fontSize = 12.5.sp), color = C.wait)
            }
            Rule()
        }
        if (accounts != null) {
            Group("Accounts", if (accounts.size > 1) "tap to switch" else "")
            if (switching != null) ConfirmBar("Switch to ${switching.name}?", "Hive signs in as ${switching.detail.ifEmpty { switching.name }}. Threads that are working keep the account they started with.", if (busy) "Switching" else "Switch", onCancel = onCancelSwitch, onConfirm = { if (!busy) onSwitch(switching) })
            accounts.forEach { a ->
                Column(Modifier.fillMaxWidth().clickable(enabled = !a.inUse && !busy) { onPick(a) }.selected(a.inUse).padding(horizontal = Pad, vertical = 10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(a.name, Modifier.weight(1f), style = T.title)
                        if (a.inUse) StateWord("IN USE") else if (a.note.isNotEmpty()) Text(a.note, style = T.mono)
                    }
                    if (a.detail.isNotEmpty()) Text(a.detail, Modifier.padding(top = 2.dp), style = T.note)
                }
                Rule()
            }
        }
    }
}

// ---------------------------------------------------------------- Teams

@Composable
fun TeamsScreen(teams: List<Team>?, notice: String = "", error: String = "", busy: String = "", onBack: () -> Unit = {}, onOpen: (String) -> Unit = {}, onPause: (Team) -> Unit = {}) {
    Column(Modifier.fillMaxSize()) {
        Head("Teams", count = teams?.size?.takeIf { it > 0 }?.toString() ?: "", onBack = onBack)
        Notice(notice)
        Notice(error)
        LazyColumn(Modifier.fillMaxSize()) {
            if (teams != null && teams.isEmpty()) item { Empty("No team is running.") }
            (teams ?: emptyList()).forEach { t ->
                item(key = "team:" + t.id) {
                    Row(Modifier.fillMaxWidth().padding(start = Pad, end = Pad, top = 12.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(t.name, Modifier.weight(1f), style = T.sub, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        StateWord(t.word, Modifier.padding(horizontal = 12.dp))
                        Act(if (t.word == "PAUSED") "Resume" else "Pause", enabled = busy != t.id) { onPause(t) }
                    }
                    if (t.goal.isNotEmpty()) Text(t.goal, Modifier.padding(horizontal = Pad).padding(bottom = 8.dp), style = T.note, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Rule()
                }
                items(t.members, key = { "member:" + t.id + ":" + it.name + ":" + it.open }) { m ->
                    Column(Modifier.fillMaxWidth().clickable(enabled = m.open.isNotEmpty()) { onOpen(m.open) }.padding(horizontal = Pad, vertical = 9.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(m.role.uppercase(), Modifier.weight(1f), style = T.mono.copy(color = C.ink, fontSize = 11.sp), maxLines = 1)
                            StateWord(m.state)
                        }
                        Text(m.name, Modifier.padding(top = 2.dp), style = T.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Rule()
                }
                if (t.posts.isNotEmpty()) {
                    item(key = "posts:" + t.id) {
                        Group("Latest posts")
                        t.posts.forEach { p ->
                            Row(Modifier.padding(horizontal = Pad, vertical = 3.dp)) {
                                Text(p.from, Modifier.width(74.dp), style = T.note.copy(color = C.ink), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(p.text, style = T.note, maxLines = 3, overflow = TextOverflow.Ellipsis)
                            }
                        }
                        Spacer(Modifier.height(10.dp))
                        Rule()
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------- New thread

// folders: null until Hive has said which there are
@Composable
fun NewThreadScreen(
    folders: List<String>?, folder: String = "", text: String = "", busy: Boolean = false, online: Boolean = true, error: String = "", notice: String = "", leaving: Boolean = false,
    onBack: () -> Unit = {}, onStay: () -> Unit = {}, onLeave: () -> Unit = {}, onFolder: (String) -> Unit = {}, onText: (String) -> Unit = {}, onStart: () -> Unit = {}, onMic: () -> Unit = {},
) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Head("New thread", right = "Cancel", onRight = onBack)
        Notice(notice)
        Notice(error)
        if (leaving) ConfirmBar("Leave without starting?", "What you typed is kept here as a draft.", "Leave", cancel = "Stay", onCancel = onStay, onConfirm = onLeave)
        Group("Repo", if (folders == null) "asking Hive" else "")
        // the folders Hive can start a thread in: the picked one takes the selection fill and bar
        (folders ?: emptyList()).forEach { f ->
            Row(Modifier.fillMaxWidth().clickable { onFolder(f) }.selected(f == folder).padding(horizontal = Pad, vertical = 9.dp)) {
                Text(Words.folderName(f), style = T.title.copy(fontWeight = if (f == folder) FontWeight.Medium else FontWeight.Normal, color = if (f == folder) C.hi else C.ink), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Rule()
        }
        if (folders != null && folders.isEmpty()) { Empty("Hive has no workspace folder set, so the thread starts in its default folder."); Rule() }
        Column(Modifier.padding(start = Pad, end = Pad, top = 12.dp)) {
            Text("What should Claude do?", style = T.label)
            UnderlineInput(text, onText, "Say what you want done", minLines = 4, maxLines = 10, style = T.title.copy(fontWeight = FontWeight.Normal))
        }
        Row(Modifier.padding(horizontal = Pad, vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Btn("Mic", Modifier.width(78.dp), onClick = onMic)
            // not before Hive has listed the folders: a thread is never started in a folder nobody chose
            Btn(if (busy) "Starting" else "Start in background", Modifier.weight(1f), primary = true, enabled = text.isNotBlank() && !busy && folders != null && online, onClick = onStart)
        }
    }
}

// ---------------------------------------------------------------- Settings

// syncs: Hive on the computer keeps the same quiet hours. unpair: the question is open.
@Composable
fun SettingsScreen(
    quiet: Quiet, buttons: Boolean, relay: String, linkWord: String, clock: String, syncs: Boolean = false, unpair: Boolean = false, online: Boolean = true, notice: String = "", version: String = "", computer: String = "",
    onBack: () -> Unit = {}, onQuiet: (Boolean) -> Unit = {}, onFrom: () -> Unit = {}, onTo: () -> Unit = {}, onButtons: (Boolean) -> Unit = {},
    onAskUnpair: () -> Unit = {}, onCancelUnpair: () -> Unit = {}, onUnpair: () -> Unit = {},
) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Head("Settings", onBack = onBack)
        Notice(notice)
        SettingRow("Quiet hours", "${quiet.from} to ${quiet.to}. Failures still ring." + if (syncs) " Hive on the computer keeps the same hours." else "", on = quiet.on, onChange = onQuiet)
        SettingRow("Quiet from", "Notifications arrive without sound after this", word = quiet.from, onClick = onFrom)
        SettingRow("Quiet until", "", word = quiet.to, onClick = onTo)
        SettingRow("Questions from Claude", "With answer buttons. A choice that ships, deletes or pays opens the app instead.", on = buttons, onChange = onButtons)
        SettingRow("Unlock with fingerprint", "Always on. Locks after 2 minutes away.", word = "on")
        SettingRow("Relay", listOf(relay, clock).filter { it.isNotEmpty() }.joinToString(", "), word = linkWord)
        if (unpair) ConfirmBar("Unpair this phone?",
            "This phone forgets the pairing, and Hive on your computer is told to drop it too" + (if (online) "." else ". The computer is not reachable now: unpair there as well, in Settings, Phone app.") + " To use the app again you pair it anew in Hive.",
            "Unpair", danger = true, onCancel = onCancelUnpair, onConfirm = onUnpair)
        else SettingRow("Unpair this phone", "", onClick = onAskUnpair)
        if (version.isNotEmpty()) Text("Hive $version", Modifier.padding(horizontal = Pad, vertical = 12.dp), style = T.mono)
        if (computer.isNotEmpty()) Text("On the computer: $computer", Modifier.padding(horizontal = Pad).padding(bottom = 12.dp), style = T.mono)
    }
}

// ---------------------------------------------------------------- Pair, Locked

// step: how far pairing got (0 nothing yet, 1 the code was read, 2 the relay answered, 3 the computer answered)
@Composable
fun PairScreen(note: String = "", error: String = "", text: String = "", paste: Boolean = false, onScan: () -> Unit = {}, onPasteMode: () -> Unit = {}, onText: (String) -> Unit = {}, onPair: () -> Unit = {}) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Head("Pair with Hive", mark = true)
        Notice(note, C.wait)
        val steps = listOf(
            "In Hive on your computer open Settings, General, Phone app and press Pair.",
            "Point this phone's camera at the code Hive shows.",
            "The phone reaches the relay and checks its clock against the computer's.",
            "From then on a fingerprint or the screen lock opens the app.",
        )
        Column(Modifier.padding(horizontal = Pad, vertical = 4.dp)) {
            steps.forEachIndexed { i, s ->
                Row(Modifier.padding(vertical = 8.dp)) {
                    Text((i + 1).toString(), Modifier.width(22.dp).padding(top = 1.dp), style = T.mono.copy(color = C.dim))
                    Text(s, style = T.body.copy(fontSize = 13.5.sp))
                }
                Rule()
            }
        }
        Btn("Scan the code", Modifier.fillMaxWidth().padding(horizontal = Pad, vertical = 12.dp), primary = true, onClick = onScan)
        if (!paste) Text("No camera? Paste the code instead.", Modifier.clickable(onClick = onPasteMode).padding(horizontal = Pad, vertical = 6.dp), style = T.note)
        else Column(Modifier.padding(horizontal = Pad)) {
            UnderlineInput(text, onText, "Paste the code from Hive", minLines = 2, maxLines = 5)
            Btn("Pair", Modifier.fillMaxWidth().padding(top = 12.dp), enabled = text.isNotBlank(), onClick = onPair)
        }
        if (error.isNotEmpty()) Text(error, Modifier.padding(horizontal = Pad, vertical = 10.dp), style = T.note, color = C.fail)
    }
}

@Composable
fun LockedScreen(note: String = "", broken: Boolean = false, onUnlock: () -> Unit = {}, onForget: () -> Unit = {}) {
    Column(Modifier.fillMaxSize()) {
        Head("Hive", right = "locked", mark = true)
        Column(Modifier.padding(horizontal = Pad, vertical = 16.dp)) {
            if (broken) {
                // the Keystore dropped the key (the screen lock was removed or reset): the pairing cannot be read again
                Text("The pairing saved on this phone can no longer be opened, because the screen lock changed. Pair this phone again in Hive on your computer.", style = T.body)
                Btn("Pair again", Modifier.fillMaxWidth().padding(top = 16.dp), primary = true, onClick = onForget)
            } else {
                Text("Unlock with your fingerprint or the screen lock. The app locks again after 2 minutes away.", style = T.body)
                Btn("Unlock", Modifier.fillMaxWidth().padding(top = 16.dp), primary = true, onClick = onUnlock)
                if (note.isNotEmpty()) Text(note, Modifier.padding(top = 12.dp), style = T.note, color = C.fail)
            }
        }
    }
}

// the tabs under every list screen, with what each holds
@Composable
fun Tabs(counts: Counts, open: Int, onOpen: (Int) -> Unit) {
    fun n(v: Int) = if (v > 0) v.toString() else "0"
    TabBar(listOf(NavTab("Needs me", n(counts.needs), warn = counts.needs > 0), NavTab("Threads", n(counts.threads)), NavTab("Running", n(counts.running)), NavTab("Scheduled", n(counts.scheduled)), NavTab("More", "")), open, onOpen)
}
