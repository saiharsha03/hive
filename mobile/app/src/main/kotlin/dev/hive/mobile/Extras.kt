package dev.hive.mobile

// The 3.0 screens: a thread's mode, model and effort, the notes, the to-dos and the watchers. Like Screens.kt, drawn
// from plain values and callbacks; MainActivity.kt wires them to the relay. Each is offered only when Hive on the
// computer says it can do it (hello's "can").
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.json.JSONObject

data class Pick(val value: String, val label: String)
data class ThreadSettings(val live: Boolean = false, val mode: String = "", val model: String = "", val effort: String = "", val modes: List<Pick> = emptyList(), val models: List<Pick> = emptyList(), val efforts: List<String> = emptyList(), val advisor: String = "")
data class Note(val id: String, val title: String, val text: String, val updated: Long)
data class Todo(val id: String, val text: String, val status: String, val due: String)
data class Watcher(val id: String, val name: String, val goal: String, val enabled: Boolean, val status: String, val note: String, val lastRun: Long, val nextRun: Long)

object ReadMore {
    private fun picks(j: JSONObject?, name: String) = objs(j?.optJSONArray(name)).map { Pick(it.optString("value"), it.optString("label")) }.filter { it.value.isNotEmpty() }
    fun settings(j: JSONObject?): ThreadSettings = ThreadSettings(j?.optBoolean("live") ?: false, j?.optString("mode") ?: "", j?.optString("model") ?: "", j?.optString("effort") ?: "",
        picks(j, "modes"), picks(j, "models"), strs(j?.optJSONArray("efforts")))
    fun notes(j: JSONObject): List<Note> = objs(j.optJSONArray("notes")).map { Note(it.optString("id"), it.optString("title"), it.optString("text"), it.optLong("updated")) }.filter { it.id.isNotEmpty() }
    fun todos(j: JSONObject): List<Todo> = objs(j.optJSONArray("todos")).map { Todo(it.optString("id"), it.optString("text"), it.optString("status", "todo"), it.optString("due")) }.filter { it.id.isNotEmpty() }
    fun watchers(j: JSONObject): List<Watcher> = objs(j.optJSONArray("watchers")).map {
        Watcher(it.optString("id"), it.optString("name"), it.optString("goal"), it.optBoolean("enabled"), it.optString("status"), it.optString("note"), it.optLong("lastRun"), it.optLong("nextRun"))
    }.filter { it.id.isNotEmpty() }
}

// "claude-opus-5-5" -> "Opus 5.5"; an alias or a name as it is
fun modelName(id: String): String {
    val m = Regex("claude-([a-z]+)-(\\d+)(?:-(\\d{1,2}))?(?!\\d)").find(id) ?: return id
    val (family, major, minor) = m.destructured
    return family.replaceFirstChar { it.uppercase() } + " " + major + if (minor.isNotEmpty()) ".$minor" else ""
}

// ---------------------------------------------------------------- a thread's mode, model and effort

// One line above the message box: the three values, each a word to tap. Tapping one opens its choices under the line.
// open: "", "mode", "model" or "effort".
@Composable
fun ThreadSettingsBar(s: ThreadSettings, open: String, onOpen: (String) -> Unit, onPick: (String, String) -> Unit) {
    val modeLabel = s.modes.firstOrNull { it.value == s.mode }?.label ?: s.mode.ifEmpty { "default" }
    Column(Modifier.fillMaxWidth().background(C.side)) {
        Rule()
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 7.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
            SettingWord("Mode", modeLabel, open == "mode", if (s.mode == "bypassPermissions") C.fail else C.hi) { onOpen(if (open == "mode") "" else "mode") }
            SettingWord("Model", if (s.model.isEmpty()) "default" else modelName(s.model), open == "model") { onOpen(if (open == "model") "" else "model") }
            SettingWord("Effort", s.effort.ifEmpty { "default" }, open == "effort") { onOpen(if (open == "effort") "" else "effort") }
            SettingWord("Advisor", if (s.advisor.isEmpty()) "off" else modelName(s.advisor), open == "advisor") { onOpen(if (open == "advisor") "" else "advisor") }
        }
        val rows: List<Pick> = when (open) {
            "mode" -> s.modes
            "model" -> s.models
            "effort" -> s.efforts.map { Pick(it, it) }
            "advisor" -> listOf(Pick("off", "Off")) + s.models.filter { it.value != "default" }
            else -> emptyList()
        }
        val now = when (open) { "mode" -> s.mode; "model" -> s.model; "advisor" -> s.advisor.ifEmpty { "off" }; else -> s.effort }
        if (open.isNotEmpty()) {
            Rule()
            if (open != "mode" && !s.live) Text("Send this thread a message first: its $open can be changed once it is running.", Modifier.padding(horizontal = 14.dp, vertical = 8.dp), style = T.note)
            else Column(Modifier.heightIn(max = 260.dp).verticalScroll(rememberScrollState())) {
                rows.forEach { p ->
                    Row(Modifier.fillMaxWidth().background(if (p.value == now) C.sel else C.side).clickable { onPick(open, p.value) }.padding(horizontal = 14.dp, vertical = 10.dp)) {
                        Text(p.label, Modifier.weight(1f), style = T.title, color = if (p.value == now) C.hi else C.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (p.value == now) Text("in use", style = T.label)
                    }
                }
            }
        }
    }
}

@Composable
private fun SettingWord(name: String, value: String, on: Boolean, color: androidx.compose.ui.graphics.Color = C.hi, onClick: () -> Unit) {
    Column(Modifier.clickable(onClick = onClick)) {
        Text(name, style = T.label, color = if (on) C.link else C.dim)
        Text(value, style = T.note.copy(fontWeight = FontWeight.Medium), color = color, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

// ---------------------------------------------------------------- Notes

// editing: null = the list; else the note being written (id "" = a new one). draft: its text.
@Composable
fun NotesScreen(
    notes: List<Note>?, editing: String? = null, draft: String = "", notice: String = "", error: String = "", saving: Boolean = false,
    onBack: () -> Unit = {}, onOpen: (Note) -> Unit = {}, onNew: () -> Unit = {}, onDraft: (String) -> Unit = {}, onSave: () -> Unit = {},
) {
    Column(Modifier.fillMaxSize()) {
        if (editing != null) {
            Head(if (editing.isEmpty()) "New note" else "Note", sub = true, onBack = onBack, right = if (saving) "Saving" else "Save", rightColor = C.link, onRight = onSave)
            Notice(notice); Notice(error)
            Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = Pad, vertical = 10.dp)) {
                UnderlineInput(draft, onDraft, "Title on the first line, then anything", minLines = 12, maxLines = 400)
            }
        } else {
            Head("Notes", count = notes?.size?.toString() ?: "", sub = true, onBack = onBack, right = "New", rightColor = C.link, onRight = onNew)
            Notice(notice); Notice(error)
            if (notes == null) Empty("Reading your notes.")
            else if (notes.isEmpty()) Empty("No notes yet. New starts one.")
            else LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
                items(notes, key = { it.id }) { n ->
                    Column(Modifier.fillMaxWidth().clickable { onOpen(n) }.padding(horizontal = Pad, vertical = 11.dp)) {
                        Text(n.title.ifEmpty { "Untitled" }, style = T.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        val rest = n.text.lineSequence().drop(1).map { it.trim() }.firstOrNull { it.isNotEmpty() } ?: ""
                        if (rest.isNotEmpty()) Text(rest, style = T.note, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Rule()
                }
            }
        }
    }
}

// ---------------------------------------------------------------- To do

@Composable
fun TodosScreen(
    todos: List<Todo>?, draft: String = "", notice: String = "", error: String = "", showDone: Boolean = false,
    onBack: () -> Unit = {}, onDraft: (String) -> Unit = {}, onAdd: () -> Unit = {}, onToggle: (Todo) -> Unit = {}, onShowDone: () -> Unit = {},
) {
    Column(Modifier.fillMaxSize()) {
        val open = todos?.filter { it.status != "done" } ?: emptyList()
        val done = todos?.filter { it.status == "done" } ?: emptyList()
        Head("To do", count = if (todos == null) "" else open.size.toString(), sub = true, onBack = onBack)
        Notice(notice); Notice(error)
        Row(Modifier.fillMaxWidth().padding(horizontal = Pad, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            UnderlineInput(draft, onDraft, "Add a to-do", Modifier.weight(1f), maxLines = 3)
            Text("Add", Modifier.clickable(enabled = draft.isNotBlank(), onClick = onAdd).padding(start = 14.dp, top = 6.dp, bottom = 6.dp), style = T.action.copy(fontWeight = FontWeight.SemiBold), color = if (draft.isNotBlank()) C.accent else C.faint)
        }
        Rule()
        if (todos == null) Empty("Reading your to-dos.")
        else LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
            if (open.isEmpty()) item { Empty("Nothing open.") }
            items(open, key = { it.id }) { t -> TodoRow(t, onToggle) }
            if (done.isNotEmpty()) {
                item { Row(Modifier.fillMaxWidth().clickable(onClick = onShowDone)) { Group(if (showDone) "Done" else "Done (tap to show)", done.size.toString()) } }
                if (showDone) items(done, key = { it.id }) { t -> TodoRow(t, onToggle) }
            }
        }
    }
}

@Composable
private fun TodoRow(t: Todo, onToggle: (Todo) -> Unit) {
    val done = t.status == "done"
    Row(Modifier.fillMaxWidth().clickable { onToggle(t) }.padding(horizontal = Pad, vertical = 11.dp), verticalAlignment = Alignment.Top) {
        Text(if (done) "[x]" else "[ ]", Modifier.padding(end = 12.dp), style = T.mono.copy(color = if (done) C.done else C.dim))
        Column(Modifier.weight(1f)) {
            Text(t.text, style = T.body.copy(color = if (done) C.dim else C.hi, textDecoration = if (done) TextDecoration.LineThrough else null))
            val words = listOf(if (t.status == "talk") "talk about" else if (t.status == "holding") "on hold" else "", t.due).filter { it.isNotEmpty() }.joinToString(", ")
            if (words.isNotEmpty()) Text(words, style = T.label)
        }
    }
    Rule()
}

// ---------------------------------------------------------------- Watchers

// busy: the watcher a run was just asked for. now: the time, for "next in 2 h".
@Composable
fun WatchersScreen(
    watchers: List<Watcher>?, notice: String = "", error: String = "", busy: String = "", done: String = "", now: Long = 0,
    onBack: () -> Unit = {}, onRun: (Watcher) -> Unit = {},
) {
    Column(Modifier.fillMaxSize()) {
        Head("Watchers", count = watchers?.size?.toString() ?: "", sub = true, onBack = onBack)
        Notice(notice); Notice(error); Notice(done, C.done)
        if (watchers == null) Empty("Reading the watchers.")
        else if (watchers.isEmpty()) Empty("No watchers on this computer.")
        else LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
            items(watchers, key = { it.id }) { w ->
                Row(Modifier.fillMaxWidth().padding(horizontal = Pad, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            StateWord(if (!w.enabled) "OFF" else w.status.ifEmpty { "idle" }, Modifier.padding(end = 8.dp))
                            Text(w.name, style = T.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        if (w.goal.isNotEmpty()) Text(w.goal, style = T.note, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        val times = listOf(if (w.lastRun > 0) "last ${Words.age(w.lastRun, now)} ago" else "", if (w.nextRun > 0) "next ${Words.until(w.nextRun, now)}" else "").filter { it.isNotEmpty() }.joinToString(", ")
                        if (times.isNotEmpty()) Text(times, style = T.label)
                        if (w.note.isNotEmpty()) Text(w.note, style = T.label.copy(color = C.wait), maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    Act(if (busy == w.id) "Starting" else "Run now", enabled = w.enabled && busy.isEmpty()) { onRun(w) }
                }
                Rule()
            }
        }
    }
}
