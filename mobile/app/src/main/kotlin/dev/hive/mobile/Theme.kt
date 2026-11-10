package dev.hive.mobile

// The look, in one place: the colours and type of the design (flat zones separated by full-width rules, state as a
// coloured uppercase word, one accent, square corners) and the few parts every screen is made of.
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

// the design's tokens (dark)
object C {
    val bg = Color(0xFF1C1F23)      // panes
    val side = Color(0xFF171A1D)    // the tab bar, the composer
    val raised = Color(0xFF23272C)  // the question card, confirm bars
    val band = Color(0xFF22262B)    // your own messages
    val sel = Color(0xFF1F2B3D)     // the selected row
    val rule = Color(0xFF2B3035)    // zone and row rules
    val rule2 = Color(0xFF3A4047)   // inputs at rest, secondary buttons
    val hi = Color(0xFFF1F3F5)      // titles, values
    val ink = Color(0xFFCBD1D7)     // body text
    val dim = Color(0xFF8A929B)     // labels, secondary text
    val faint = Color(0xFF5D656D)   // placeholders, times
    val accent = Color(0xFF3D8BFF)  // the active item and the primary action only
    val link = Color(0xFF6AA6FF)
    val work = Color(0xFF4FC1E0)
    val wait = Color(0xFFF2B33D)
    val fail = Color(0xFFF2605A)
    val done = Color(0xFF6CCB8E)
    val hold = Color(0xFFC9A86A)
}

val Sans = FontFamily(
    Font(R.font.space_grotesk_regular, FontWeight.Normal),
    Font(R.font.space_grotesk_medium, FontWeight.Medium),
    Font(R.font.space_grotesk_bold, FontWeight.SemiBold),
    Font(R.font.space_grotesk_bold, FontWeight.Bold),
)
val Mono = FontFamily(Font(R.font.space_mono_regular, FontWeight.Normal), Font(R.font.space_mono_bold, FontWeight.Bold))

object T {
    val page = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Bold, fontSize = 21.sp, lineHeight = 26.sp, color = C.hi)
    val sub = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Bold, fontSize = 17.sp, lineHeight = 21.sp, color = C.hi)
    val title = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Medium, fontSize = 15.sp, lineHeight = 20.sp, color = C.hi)
    val body = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Normal, fontSize = 14.sp, lineHeight = 20.sp, color = C.ink)
    val conv = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Normal, fontSize = 14.5.sp, lineHeight = 23.5.sp, color = C.ink)
    val note = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Normal, fontSize = 13.sp, lineHeight = 18.sp, color = C.dim)
    val label = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Normal, fontSize = 12.sp, lineHeight = 16.sp, color = C.dim)
    val state = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Bold, fontSize = 10.5.sp, lineHeight = 14.sp, letterSpacing = 0.09.em)
    val mono = TextStyle(fontFamily = Mono, fontWeight = FontWeight.Normal, fontSize = 12.sp, lineHeight = 17.sp, color = C.faint)
    val action = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Normal, fontSize = 13.sp, lineHeight = 18.sp, color = C.link)
}

val Pad = 18.dp

@Composable
fun HiveTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = darkColorScheme(primary = C.accent, onPrimary = Color.White, background = C.bg, surface = C.bg, onBackground = C.ink, onSurface = C.ink, error = C.fail)) {
        androidx.compose.runtime.CompositionLocalProvider(androidx.compose.material3.LocalTextStyle provides T.body, content = content)
    }
}

// the colour of a state word
fun stateColor(word: String): Color = when (word.uppercase()) {
    "WORKING", "LOOP", "RUNNING" -> C.work
    "WAITING", "FINDING", "NEW" -> C.wait
    "FAILED" -> C.fail
    "DONE", "IN USE", "ONLINE", "SEEN BY CLAUDE", "CLEARED" -> C.done
    "PAUSED", "AUTO-CONTINUE" -> C.hold
    "WAKE-UP" -> Color(0xFFB9D7FF)
    "WATCHER" -> C.work
    else -> C.dim
}

// state is a coloured uppercase word, never a dot or a badge
@Composable
fun StateWord(word: String, modifier: Modifier = Modifier, color: Color = stateColor(word)) = Text(word.uppercase(), modifier, style = T.state, color = color, maxLines = 1)

@Composable
fun Rule(color: Color = C.rule) = Box(Modifier.fillMaxWidth().height(1.dp).background(color))

// a screen's head: the title, a count beside it, and one word or action at the right
@Composable
fun Head(title: String, count: String = "", right: String = "", rightColor: Color = C.dim, sub: Boolean = false, mark: Boolean = false, onRight: (() -> Unit)? = null, onBack: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(start = Pad, end = Pad, top = 8.dp, bottom = 10.dp)) {
        if (onBack != null) Text("Back", Modifier.clickable(onClick = onBack).padding(end = 12.dp).alignByBaseline(), style = T.action)
        // the mark (an H in a cell, its crossbar in the accent) on the screens that stand before the app: Locked, Pair
        if (mark) androidx.compose.foundation.Image(androidx.compose.ui.res.painterResource(R.drawable.ic_hive_mark), contentDescription = null, modifier = Modifier.padding(end = 10.dp).size(24.dp).align(Alignment.CenterVertically))
        // the title takes what it needs, the count sits right after it, and the word at the right keeps the edge
        Row(Modifier.weight(1f).alignByBaseline()) {
            Text(title, Modifier.weight(1f, fill = false).alignByBaseline(), style = if (sub) T.sub else T.page, maxLines = if (sub) 2 else 1, overflow = TextOverflow.Ellipsis)
            if (count.isNotEmpty()) Text(count, Modifier.padding(start = 10.dp).alignByBaseline(), style = T.note)
        }
        if (right.isNotEmpty()) Text(right, (if (onRight != null) Modifier.clickable(onClick = onRight) else Modifier).padding(start = 10.dp).alignByBaseline(), style = T.note.copy(fontSize = 12.5.sp), color = rightColor, maxLines = 1)
    }
    Rule()
}

// a group heading inside a list
@Composable
fun Group(label: String, right: String = "", color: Color = C.dim) {
    Row(Modifier.fillMaxWidth().padding(start = Pad, end = Pad, top = 12.dp, bottom = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = T.label.copy(fontWeight = FontWeight.SemiBold), color = color)
        if (right.isNotEmpty()) Text(right, style = T.label.copy(fontWeight = FontWeight.SemiBold), color = color)
    }
}

// the selected row: its fill and the 3 dp accent bar at the left
fun Modifier.selected(on: Boolean, bar: Color = C.accent): Modifier = if (!on) this else background(C.sel).drawBehind { drawRect(bar, Offset.Zero, Size(3.dp.toPx(), size.height)) }

// one list row: title and a time, then a line with the state word and what it is doing, then its actions; a rule under it
@Composable
fun ListRow(
    title: String, meta: String = "", word: String = "", note: String = "", detail: String = "", on: Boolean = false,
    // metaWord: a word with a time in place of the age (WAKES 14:00), in the state type
    metaWord: String = "", metaColor: Color = C.hi,
    onClick: (() -> Unit)? = null, actions: @Composable (RowScope.() -> Unit)? = null,
) {
    Column((if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).fillMaxWidth().selected(on).padding(horizontal = Pad, vertical = 10.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            Text(title, Modifier.weight(1f), style = T.title, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (metaWord.isNotEmpty()) StateWord(metaWord, Modifier.padding(start = 10.dp, top = 4.dp), metaColor)
            else if (meta.isNotEmpty()) Text(meta, Modifier.padding(start = 10.dp, top = 2.dp), style = T.mono, maxLines = 1)
        }
        if (word.isNotEmpty() || note.isNotEmpty()) Row(Modifier.padding(top = 2.dp)) {
            if (word.isNotEmpty()) StateWord(word, Modifier.padding(end = 6.dp, top = 3.dp))
            Text(note, style = T.note, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (detail.isNotEmpty()) Text(detail, Modifier.padding(top = 2.dp), style = T.mono.copy(color = C.dim), maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (actions != null) Row(Modifier.padding(top = 7.dp), horizontalArrangement = Arrangement.spacedBy(18.dp), content = actions)
    }
    Rule()
}

// a row's action: a word in the link colour (red for one that stops or cancels, grey for the quiet one)
@Composable
fun Act(label: String, color: Color = C.link, enabled: Boolean = true, onClick: () -> Unit) =
    Text(label, Modifier.clickable(enabled = enabled, onClick = onClick).padding(vertical = 2.dp), style = T.action, color = if (enabled) color else C.faint, maxLines = 1, overflow = TextOverflow.Ellipsis)

// buttons are square-cornered: solid accent for the primary one, a 1 dp outline for the rest
@Composable
fun Btn(label: String, modifier: Modifier = Modifier, primary: Boolean = false, danger: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    val shape = RoundedCornerShape(2.dp)
    val fill = when { !enabled && (primary || danger) -> C.rule2; danger -> C.fail; primary -> C.accent; else -> Color.Transparent }
    Box(
        modifier.background(fill, shape).then(if (primary || danger) Modifier else Modifier.border(1.dp, C.rule2, shape)).clickable(enabled = enabled, onClick = onClick).padding(vertical = 10.dp, horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) { Text(label, style = T.body.copy(fontWeight = FontWeight.SemiBold), color = if (!enabled) C.faint else if (primary || danger) Color.White else C.hi, maxLines = 1) }
}

// a switch drawn square: an outline with a grey block when off, the accent with a white block when on
@Composable
fun Toggle(on: Boolean, onChange: ((Boolean) -> Unit)?) {
    Box(
        Modifier.size(36.dp, 18.dp).then(if (on) Modifier.background(C.accent) else Modifier.border(1.dp, C.rule2))
            .then(if (onChange != null) Modifier.clickable { onChange(!on) } else Modifier),
    ) { Box(Modifier.padding(start = if (on) 21.dp else 3.dp, top = 3.dp).size(12.dp).background(if (on) Color.White else C.dim)) }
}

// a setting: its name, one line about it, and a switch or a word at the right
@Composable
fun SettingRow(name: String, about: String = "", on: Boolean? = null, word: String = "", onClick: (() -> Unit)? = null, onChange: ((Boolean) -> Unit)? = null) {
    Row((if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).fillMaxWidth().padding(horizontal = Pad, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(name, style = T.body.copy(fontWeight = FontWeight.Medium, color = C.hi))
            if (about.isNotEmpty()) Text(about, style = T.note.copy(fontSize = 12.5.sp))
        }
        if (word.isNotEmpty()) Text(word, Modifier.padding(start = 10.dp), style = T.mono)
        if (on != null) { Spacer(Modifier.width(10.dp)); Toggle(on, onChange) }
    }
    Rule()
}

// a form field as the design draws it: a dim label, the value on an underline, a word at the right
@Composable
fun Field(label: String, value: String, right: String = "", onClick: (() -> Unit)? = null) {
    Column((if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).fillMaxWidth().padding(start = Pad, end = Pad, top = 10.dp)) {
        Text(label, style = T.label)
        Row(Modifier.fillMaxWidth().padding(top = 5.dp, bottom = 7.dp), verticalAlignment = Alignment.Bottom) {
            Text(value, Modifier.weight(1f), style = T.title.copy(fontWeight = FontWeight.Normal), maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (right.isNotEmpty()) Text(right, style = T.note)
        }
        Rule(C.rule2)
    }
}

// text input on an underline (the accent while it is the one to type in)
@Composable
fun UnderlineInput(value: String, onChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier, minLines: Int = 1, maxLines: Int = 6, style: TextStyle = T.body.copy(color = C.hi), rule: Color = C.accent, trailing: (@Composable () -> Unit)? = null) {
    Column(modifier) {
        Row(Modifier.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) {
                if (value.isEmpty()) Text(placeholder, style = style.copy(color = C.faint), maxLines = 1, overflow = TextOverflow.Ellipsis)
                BasicTextField(value, onChange, Modifier.fillMaxWidth(), textStyle = style, cursorBrush = SolidColor(C.accent), minLines = minLines, maxLines = maxLines,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences))
            }
            if (trailing != null) { Spacer(Modifier.width(10.dp)); trailing() }
        }
        Rule(rule)
    }
}

// a small square box button with a word in it (Mic)
@Composable
fun BoxWord(word: String, on: Boolean = false, onClick: () -> Unit) {
    Box(Modifier.size(34.dp).then(if (on) Modifier.background(C.fail, RoundedCornerShape(2.dp)) else Modifier.border(1.dp, C.rule2, RoundedCornerShape(2.dp))).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Text(word, style = T.label.copy(fontWeight = FontWeight.Bold, color = if (on) Color.White else C.hi))
    }
}

// A question before something that cannot be taken back, in the page (no floating dialog): a raised zone with a
// coloured rule on top, what will happen, and the two buttons.
@Composable
fun ConfirmBar(title: String, text: String, confirm: String, danger: Boolean = false, cancel: String = "Cancel", onCancel: () -> Unit, onConfirm: () -> Unit, extra: (@Composable ColumnScope.() -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().padding(horizontal = Pad, vertical = 14.dp).background(C.raised).drawBehind { drawRect(if (danger) C.fail else C.wait, Offset.Zero, Size(size.width, 2.dp.toPx())) }.padding(14.dp)) {
        Text(title, style = T.title.copy(fontWeight = FontWeight.SemiBold, fontSize = 16.sp))
        if (text.isNotEmpty()) Text(text, Modifier.padding(top = 4.dp), style = T.note)
        if (extra != null) extra()
        Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Btn(cancel, Modifier.weight(1f), onClick = onCancel)
            Btn(confirm, Modifier.weight(1f), primary = !danger, danger = danger, onClick = onConfirm)
        }
    }
}

// a line under a head that says what went wrong, or how the link is
@Composable
fun Notice(text: String, color: Color = C.fail) {
    if (text.isEmpty()) return
    Text(text, Modifier.fillMaxWidth().padding(horizontal = Pad, vertical = 8.dp), style = T.note, color = color)
    Rule()
}

@Composable
fun Empty(text: String) = Text(text, Modifier.fillMaxWidth().padding(horizontal = Pad, vertical = 16.dp), style = T.note)

// the five tabs: a count in mono over the name, a 2 dp accent rule over the one that is open
data class NavTab(val name: String, val count: String, val warn: Boolean = false)

@Composable
fun TabBar(tabs: List<NavTab>, open: Int, onOpen: (Int) -> Unit) {
    Column(Modifier.fillMaxWidth().background(C.side)) {
        Rule()
        Row(Modifier.fillMaxWidth().height(58.dp)) {
            tabs.forEachIndexed { i, t ->
                val on = i == open
                Column(
                    Modifier.weight(1f).fillMaxHeight().clickable { onOpen(i) }.drawBehind { if (on) drawRect(C.accent, Offset.Zero, Size(size.width, 2.dp.toPx())) },
                    verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(t.count.ifEmpty { "_" }, style = T.mono.copy(color = when { t.warn -> C.wait; on -> C.accent; else -> C.ink }), maxLines = 1)
                    Text(t.name, Modifier.padding(top = 3.dp), style = T.label.copy(fontSize = 11.5.sp, color = if (on) C.hi else C.dim), maxLines = 1, textAlign = TextAlign.Center)
                }
            }
        }
    }
}

// a thin bar: how much of a limit is used
@Composable
fun Meter(fraction: Float, color: Color, height: Dp = 3.dp) {
    Box(Modifier.fillMaxWidth().height(height).background(C.rule2)) { Box(Modifier.fillMaxWidth(fraction.coerceIn(0f, 1f)).fillMaxHeight().background(color)) }
}
