package dev.hive.mobile

// 3.1: a thread in more detail. Its context and what it waits on, always in view; then Work (reviews apart, each
// opening to its type, model, prompt and current step), Rewind and the PR gate, each opening under that line.
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.json.JSONObject

data class Work(val id: String, val kind: String, val review: Boolean, val title: String, val now: String, val startedAt: Long, val tokens: Long, val type: String, val model: String, val prompt: String)
data class Point(val uuid: String, val text: String, val at: Long)
data class GateItem(val id: String, val title: String, val state: String)
data class Gate(val sha: String, val branch: String, val done: Int, val total: Int, val marker: Boolean, val items: List<GateItem>)
data class ThreadMore(val contextTotal: Long = 0, val contextMax: Long = 0, val waiting: String = "", val work: List<Work> = emptyList(), val points: List<Point> = emptyList(), val busy: Boolean = false, val advisor: String = "", val gate: Gate? = null)

object ReadMore2 {
    fun more(j: JSONObject?): ThreadMore {
        if (j == null) return ThreadMore()
        val c = j.optJSONObject("context")
        val g = j.optJSONObject("gate")
        return ThreadMore(
            c?.optLong("total") ?: 0, c?.optLong("max") ?: 0, j.optString("waiting"),
            objs(j.optJSONArray("work")).map { Work(it.optString("id"), it.optString("kind"), it.optBoolean("review"), it.optString("title"), it.optString("now"), it.optLong("startedAt"), it.optLong("tokens"), it.optString("type"), it.optString("model"), it.optString("prompt")) },
            objs(j.optJSONArray("points")).map { Point(it.optString("uuid"), it.optString("text"), it.optLong("at")) }.filter { it.uuid.isNotEmpty() },
            j.optBoolean("busy"), j.optString("advisor"),
            g?.let { x -> Gate(x.optString("sha"), x.optString("branch"), x.optInt("done"), x.optInt("total"), x.optBoolean("marker"), objs(x.optJSONArray("items")).map { GateItem(it.optString("id"), it.optString("title"), it.optString("state")) }) },
        )
    }

    fun versions(j: JSONObject?): String {
        if (j == null) return ""
        val c = j.optJSONObject("claude")?.optString("version").orEmpty()
        val s = j.optJSONObject("sdk")?.optString("version").orEmpty()
        return listOfNotNull(c.takeIf { it.isNotEmpty() }?.let { "Claude Code $it" }, s.takeIf { it.isNotEmpty() }?.let { "SDK $it" }).joinToString(", ")
    }
}

private val kReview = Color(0xFFCE9178)
private fun tokensWord(n: Long) = if (n >= 1_000_000) String.format(java.util.Locale.ROOT, "%.2fM", n / 1e6) else if (n >= 1000) "${n / 1000}k" else "$n"

// pane: "", "work", "rewind" or "gate". rewinding: the message a rewind is running for.
@Composable
fun ThreadMoreBar(m: ThreadMore, pane: String, now: Long, online: Boolean, rewinding: String, onPane: (String) -> Unit, onRewind: (Point) -> Unit, onChanges: (() -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().background(C.side)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = Pad, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            if (m.contextMax > 0) Text("Context ${tokensWord(m.contextTotal)} of ${tokensWord(m.contextMax)}", style = T.label)
            Spacer(Modifier.weight(1f))
            val tabs = listOfNotNull("work" to (if (m.work.isNotEmpty()) "Work ${m.work.size}" else "Work"), "rewind" to "Rewind", if (m.gate != null) "gate" to "PR gate" else null)
            tabs.forEach { (k, label) ->
                Text(label, Modifier.clickable { onPane(if (pane == k) "" else k) }, style = T.label.copy(fontWeight = if (pane == k) FontWeight.SemiBold else FontWeight.Normal), color = if (pane == k) C.link else C.dim)
            }
            // 3.2: the thread's branch, files and PR on their own screen (only when this Hive answers for them)
            if (onChanges != null) Text("Changes", Modifier.clickable(onClick = onChanges), style = T.label, color = C.dim)
        }
        if (m.waiting.isNotEmpty()) {
            val tone = when { m.waiting.contains("review") -> kReview; m.waiting.contains("advisor") -> C.wait; else -> C.work }
            Row(Modifier.fillMaxWidth().padding(horizontal = Pad).padding(bottom = 6.dp).background(tone.copy(alpha = 0.14f)).padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.width(3.dp).height(16.dp).background(tone))
                Text(m.waiting, Modifier.padding(start = 8.dp), style = T.note.copy(fontWeight = FontWeight.Medium), color = C.hi, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        when (pane) {
            "work" -> Column(Modifier.heightIn(max = 320.dp).verticalScroll(rememberScrollState())) {
                if (m.work.isEmpty()) Empty("Nothing is running in the background.")
                val (reviews, rest) = m.work.partition { it.review }
                if (reviews.isNotEmpty()) Group("Reviews", reviews.size.toString(), kReview)
                reviews.forEach { WorkRow(it, now, kReview) }
                if (rest.isNotEmpty()) Group("Running", rest.size.toString())
                rest.forEach { WorkRow(it, now, C.work) }
            }
            "rewind" -> Column(Modifier.heightIn(max = 320.dp).verticalScroll(rememberScrollState())) {
                Text("Go back to before one of your messages: the files Claude changed since are put back, and the conversation goes back with them.", Modifier.padding(horizontal = Pad, vertical = 6.dp), style = T.label)
                if (m.busy) Text("Stop Claude first: a thread that is working cannot be rewound.", Modifier.padding(horizontal = Pad, vertical = 4.dp), style = T.label, color = C.wait)
                if (m.points.isEmpty()) Empty("Nothing to rewind to yet.")
                m.points.forEach { p ->
                    Row(Modifier.fillMaxWidth().padding(horizontal = Pad, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(p.text.ifEmpty { "A message with only pictures" }, style = T.body, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            if (p.at > 0) Text(Words.clock(p.at, now), style = T.label)
                        }
                        Act(if (rewinding == p.uuid) "Rewinding" else "Rewind", C.fail, enabled = online && !m.busy && rewinding.isEmpty()) { onRewind(p) }
                    }
                    Rule()
                }
            }
            "gate" -> m.gate?.let { g ->
                Column(Modifier.heightIn(max = 320.dp).verticalScroll(rememberScrollState())) {
                    val all = g.total > 0 && g.done == g.total
                    Row(Modifier.fillMaxWidth().padding(horizontal = Pad, vertical = 6.dp)) {
                        Text(if (all) "Reviewed" else if (g.marker) "${g.done} of ${g.total} done" else "Not reviewed yet", Modifier.weight(1f), style = T.title, color = if (all) C.done else if (g.marker) C.wait else C.fail)
                        Text("${g.branch} ${g.sha}".trim(), style = T.mono)
                    }
                    g.items.forEach { i ->
                        Row(Modifier.fillMaxWidth().padding(horizontal = Pad, vertical = 4.dp)) {
                            Text(i.id, Modifier.width(36.dp), style = T.mono)
                            Text(i.title, Modifier.weight(1f), style = T.note, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            val word = when (i.state) { "PASS" -> "pass"; "FIXED" -> "fixed"; "NA" -> "n/a"; else -> "to do" }
                            Text(word, style = T.label.copy(fontWeight = FontWeight.SemiBold), color = when (i.state) { "PASS", "FIXED" -> C.done; "NA" -> C.dim; else -> C.wait })
                        }
                    }
                }
            }
        }
        Rule()
    }
}

@Composable
private fun WorkRow(w: Work, now: Long, tone: Color) {
    var open by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().clickable { open = !open }.padding(horizontal = Pad, vertical = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(if (open) "v" else ">", Modifier.width(14.dp), style = T.mono)
            Text(w.title, Modifier.weight(1f), style = T.title, maxLines = if (open) 4 else 1, overflow = TextOverflow.Ellipsis)
            if (w.startedAt > 0) Text(Words.age(w.startedAt, now), style = T.label.copy(fontWeight = FontWeight.SemiBold), color = tone)
        }
        if (!open && w.now.isNotEmpty()) Text(w.now, Modifier.padding(start = 14.dp), style = T.mono.copy(color = C.dim), maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (open) {
            Column(Modifier.padding(start = 14.dp, top = 6.dp).fillMaxWidth().background(C.bg).padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                val rows = listOf(
                    "Type" to listOf(w.kind, w.type).filter { it.isNotEmpty() }.joinToString(", "),
                    "Model" to (if (w.model.isNotEmpty()) modelName(w.model) else "the thread's model"),
                    "Now" to w.now.ifEmpty { "working" },
                    "Used" to (if (w.tokens > 0) "${tokensWord(w.tokens)} tokens" else ""),
                )
                rows.forEach { (k, v) -> if (v.isNotEmpty()) Row { Text(k, Modifier.width(52.dp), style = T.label); Text(v, style = T.note.copy(color = C.ink)) } }
                Text("Prompt", style = T.label)
                Text(w.prompt.ifEmpty { w.title }, style = T.mono.copy(color = C.ink), maxLines = 30, overflow = TextOverflow.Ellipsis)
            }
        }
    }
    Rule()
}
