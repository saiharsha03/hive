package dev.hive.mobile

// The rules behind the screens (Model.kt), on the JVM: what Orbit's JSON becomes, ages and clock times, the usage
// forecast, quiet hours, and what a notification's buttons do.
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneOffset

class ModelTest {
    private val utc = ZoneOffset.UTC
    private val now = Instant.parse("2026-11-09T13:27:00Z").toEpochMilli()
    private fun at(iso: String) = Instant.parse(iso).toEpochMilli()

    @Test fun agesAreShort() {
        assertEquals("", Words.age(0, now)) // an older Orbit sends no time
        assertEquals("38s", Words.age(now - 38_000, now))
        assertEquals("6m", Words.age(now - 6 * 60_000, now))
        assertEquals("3h", Words.age(now - 183 * 60_000, now))
        assertEquals("2d", Words.age(now - 50 * 3_600_000L, now))
        assertEquals("0s", Words.age(now + 5_000, now)) // the phone clock a little behind: never a negative age
    }

    @Test fun clockTimesSayTheDayOnlyWhenItIsNotToday() {
        assertEquals("14:00", Words.clock(at("2026-11-09T14:00:00Z"), now, utc))
        assertEquals("Thu 09:00", Words.clock(at("2026-11-12T09:00:00Z"), now, utc))
        assertEquals("30 Nov", Words.clock(at("2026-11-30T09:00:00Z"), now, utc))
        assertEquals("", Words.clock(0, now, utc))
    }

    @Test fun untilCountsDown() {
        assertEquals("33m", Words.until(at("2026-11-09T14:00:00Z"), now))
        assertEquals("1h 33m", Words.until(at("2026-11-09T15:00:00Z"), now))
        assertEquals("2d 19h", Words.until(at("2026-11-12T09:00:00Z"), now))
        assertEquals("now", Words.until(now - 1, now))
    }

    @Test fun timesOfDay() {
        assertEquals(22 * 60, Words.minutes("22:00"))
        assertEquals(7 * 60 + 5, Words.minutes("7:05"))
        for (bad in listOf("", "24:00", "12:60", "noon", "12", "1:2:3")) assertNull(bad, Words.minutes(bad))
        assertEquals("07:05", Words.hhmm(7 * 60 + 5))
        assertEquals("00:00", Words.hhmm(24 * 60))
    }

    @Test fun wordsForARow() {
        assertEquals("WAKE-UP", Words.wakeWord(Wake("wake", "1", "s", "t", 1, "p", null)))
        assertEquals("LOOP", Words.wakeWord(Wake("wake", "1", "s", "t", 1, "p", 10)))
        assertEquals("AUTO-CONTINUE", Words.wakeWord(Wake("continue", "s", "s", "t", 1, "p", null)))
        assertEquals("ledger-api", Words.folderName("C:\\work\\ledger\\ledger-api"))
        assertEquals("ledger-api", Words.folderName("/home/orin/work/ledger-api/"))
        assertEquals("1 thread", Words.plural(1, "thread"))
        assertEquals("0 threads", Words.plural(0, "thread"))
    }

    @Test fun usageSaysWhenItResetsAndWhenItWouldRunOut() {
        // the 5-hour window opened at 10:00; 78% after 3 h 27 m reaches 100% at 14:25, before the 15:00 reset
        val five = Limit("five_hour", "Current session (5 hours)", 78.0, "2026-11-09T15:00:00Z")
        assertEquals("resets 15:00, in 1h 33m", Usage.resets(five, now, utc))
        assertEquals("At this rate you reach 100% at 14:25", Usage.forecast(five, now, utc))
        // 62% at the same point lasts past the reset: nothing to warn about
        assertEquals("", Usage.forecast(five.copy(pct = 62.0), now, utc))
        // nearly empty, already full, barely begun, no reset time, or a window Orbit does not describe: no forecast
        assertEquals("", Usage.forecast(five.copy(pct = 5.0), now, utc))
        assertEquals("", Usage.forecast(five.copy(pct = 100.0), now, utc))
        assertEquals("", Usage.forecast(five.copy(pct = 30.0), at("2026-11-09T10:05:00Z"), utc))
        assertEquals("", Usage.forecast(five.copy(resetsAt = null), now, utc))
        assertEquals("", Usage.forecast(five.copy(key = "monthly"), now, utc))
        assertEquals("", Usage.resets(five.copy(resetsAt = null), now, utc))
        val week = Limit("seven_day_opus", "Current week (Opus)", 41.0, "2026-11-12T09:00:00Z")
        assertEquals("resets Thu 09:00", Usage.resets(week, now, utc)) // more than a day out: no countdown
        assertEquals(7 * 86_400_000L, Usage.windowMs("seven_day_opus"))
    }

    @Test fun theUsageGuardSaysWhatPausesAndWhenItCarriesOn() {
        val five = Limit("five_hour", "Current session (5 hours)", 92.0, "2026-11-09T15:00:00Z")
        val week = Limit("seven_day_opus", "Current week (Opus)", 41.0, "2026-11-12T09:00:00Z")
        assertEquals(five, Usage.guard(listOf(week, five), now))
        assertNull(Usage.guard(listOf(week, five.copy(pct = 84.0)), now)) // under 85%
        assertNull(Usage.guard(listOf(five.copy(resetsAt = "2026-11-09T13:00:00Z")), now)) // already reset
        assertEquals("seven_day_opus", Usage.guard(listOf(five, week.copy(pct = 97.0)), now)!!.key) // the fuller one
        val wakes = listOf(Wake("wake", "1", "s", "A", at("2026-11-09T14:00:00Z"), "p", null), Wake("wake", "2", "s", "B", at("2026-11-09T16:00:00Z"), "p", null), Wake("continue", "c", "c", "C", at("2026-11-09T15:00:00Z"), "p", null))
        // opened 10:00, 92% after 3 h 27 m: full at 13:45
        assertEquals("The 5-hour window is at 92%. If the rate holds it fills at 13:45. 4 working threads pause then and continue at 15:00. 1 wake-up is due before then.", Usage.guardWords(five, now, 4, wakes, utc))
        assertEquals("The 5-hour window is at 92%. If the rate holds it fills at 13:45. 1 working thread pauses then and continues at 15:00.", Usage.guardWords(five, now, 1, emptyList(), utc))
        assertEquals("The 5-hour window is at 92%. If the rate holds it fills at 13:45. It resets at 15:00.", Usage.guardWords(five, now, 0, emptyList(), utc))
        assertEquals("The 5-hour window is at 100%. It is full. It resets at 15:00.", Usage.guardWords(five.copy(pct = 100.0), now, 0, emptyList(), utc))
        // slow enough to last: said so, and nothing pauses
        assertEquals("The 5-hour window is at 86%. At this rate it lasts until it resets at 13:40.", Usage.guardWords(five.copy(pct = 86.0, resetsAt = "2026-11-09T13:40:00Z"), now, 0, emptyList(), utc))
        assertEquals(listOf("5-hour window", "7-day window", "7-day Opus window", "plan window"), listOf("five_hour", "seven_day", "seven_day_opus", "monthly").map { Usage.windowName(it) })
    }

    @Test fun aThreadRowCarriesItsNextWakeUp() {
        val rows = Read.threads(JSONObject("""{"threads":[{"id":"t1","wakes":1700000000000},{"id":"t2","continues":1700000003000},{"id":"t3"}]}"""))
        assertEquals(listOf(1700000000000L, 0L, 0L), rows.map { it.wakes })
        assertEquals(listOf(0L, 1700000003000L, 0L), rows.map { it.continues })
        assertEquals(4, Read.inbox(JSONObject("""{"counts":{"working":4}}""")).counts.working)
    }

    @Test fun quietHoursRunOverMidnightAndLetFailuresThrough() {
        val q = Quiet(true, "22:00", "07:00")
        assertTrue(QuietHours.within(q, 23 * 60))
        assertTrue(QuietHours.within(q, 3 * 60))
        assertTrue(QuietHours.within(q, 22 * 60)) // from is inside
        assertFalse(QuietHours.within(q, 7 * 60)) // until is outside
        assertFalse(QuietHours.within(q, 13 * 60))
        assertFalse(QuietHours.within(q.copy(on = false), 23 * 60))
        val day = Quiet(true, "09:00", "17:00")
        assertTrue(QuietHours.within(day, 12 * 60))
        assertFalse(QuietHours.within(day, 20 * 60))
        assertFalse(QuietHours.within(Quiet(true, "08:00", "08:00"), 8 * 60)) // no span
        assertFalse(QuietHours.within(Quiet(true, "late", "07:00"), 23 * 60))
        assertTrue(QuietHours.silent(q, "done", 23 * 60))
        assertTrue(QuietHours.silent(q, "ask", 23 * 60))
        assertFalse(QuietHours.silent(q, "fail", 23 * 60)) // a failure still rings
        assertFalse(QuietHours.silent(q, "done", 13 * 60))
    }

    private fun note(more: JSONObject.() -> Unit = {}) = JSONObject().put("op", "notify").put("title", "Question: Ship").put("body", "Promote?").put("thread", "t1").apply(more)
    private fun ask(vararg opts: Pair<String, Boolean>) = JSONObject().put("id", "a1").put("opts", JSONArray(opts.map { (l, open) -> JSONObject().put("l", l).apply { if (open) put("open", true) } }))

    @Test fun aNotificationsButtons() {
        // a question: its choices; the ones Orbit marked open the app instead of answering
        val q = note { put("ask", ask("Wait to 14:00" to false, "Promote now" to true)) }
        assertEquals(listOf(NoteButton("Wait to 14:00", "answer", "a1"), NoteButton("Promote now", "open", "a1")), NoteButtons.of(q))
        assertEquals(emptyList<NoteButton>(), NoteButtons.of(q, buttons = false)) // switched off in Settings
        // Android shows three
        assertEquals(3, NoteButtons.of(note { put("ask", ask("A" to false, "B" to false, "C" to false, "D" to false)) }).size)
        // a working thread: Stop; a question wins over Stop
        assertEquals(listOf(NoteButton("Stop", "stop")), NoteButtons.of(note { put("stop", true) }))
        assertEquals("answer", NoteButtons.of(note { put("stop", true); put("ask", ask("No" to false)) }).single().op)
        // nothing to act on: no thread, no choices, an ask without an id
        assertEquals(emptyList<NoteButton>(), NoteButtons.of(note()))
        assertEquals(emptyList<NoteButton>(), NoteButtons.of(note { put("thread", ""); put("stop", true) }))
        assertEquals(emptyList<NoteButton>(), NoteButtons.of(note { put("ask", JSONObject().put("opts", JSONArray().put(JSONObject().put("l", "No")))) }))
    }

    @Test fun whatAPressedButtonSends() {
        val a = NoteButtons.request(NoteButton("Wait to 14:00", "answer", "a1"), "t1", 1_700_000_000_123L)
        assertEquals(listOf("answer", "t1", "a1", "Wait to 14:00"), listOf(a.getString("op"), a.getString("id"), a.getString("ask"), a.getString("label")))
        assertEquals(1_700_000_000_123L, a.getLong("seq"))
        val s = NoteButtons.request(NoteButton("Stop", "stop"), "t1", 5)
        assertEquals("stop", s.getString("op"))
        assertFalse(s.has("label")) // Stop carries nothing but the thread
        assertFalse(s.has("ask"))
    }

    @Test fun whatHiveSendsIsReadLeniently() {
        val box = Read.inbox(JSONObject("""{"needs":[
            {"kind":"waiting","thread":"t1","title":"Ship","note":"Promote?","at":5,"ask":{"id":"a1","question":"Promote?","options":["Wait","Promote now"]}},
            {"kind":"failed","thread":"t2","title":"Bump node","note":"docker build failed","at":4},
            {"kind":"waiting","title":"no thread"}],
          "coming":[{"kind":"wake","id":"7","open":"s1","title":"Deploy","at":9,"prompt":"check it","every":null},{"kind":"wake","id":"7","open":"s1","title":"twice","at":9,"prompt":"","every":10}],
          "counts":{"needs":2,"threads":10,"running":7,"scheduled":5}}"""))
        assertEquals(listOf("t1", "t2"), box.needs.map { it.thread }) // a row without a thread is dropped
        assertEquals(listOf("Wait", "Promote now"), box.needs[0].options)
        assertEquals("a1", box.needs[0].askId)
        assertEquals(emptyList<String>(), box.needs[1].options)
        assertEquals(1, box.coming.size) // the same wake-up twice is one row
        assertNull(box.coming[0].every)
        assertEquals(Counts(2, 10, 7, 5, 0), box.counts)
        assertEquals(Inbox(), Read.inbox(JSONObject())) // an older Orbit: nothing, not a crash

        val v = Read.thread(JSONObject("""{"title":"Ship","working":true,"items":[{"k":"you","t":"go","seen":true},{"k":"you","t":"and this","seen":false},{"k":"claude","t":"ok"}],
          "asks":[{"id":"a1","questions":[{"question":"Promote?","header":"Deploy","multiSelect":false,"options":[{"label":"Now","description":"ships 14 commits"}]}]},{"id":"a2","questions":[]}],
          "tasks":[{"id":"b1","kind":"Shell","title":"pytest","now":"PASSED"}]}"""))
        assertEquals(listOf(true, false, null), v.items.map { it.seen }) // seen only where Orbit says
        assertEquals(listOf("a1"), v.asks.map { it.id }) // an ask without questions is not a card
        assertEquals("ships 14 commits", v.asks[0].questions[0].options[0].description)
        assertTrue(v.working)
        assertEquals("pytest", v.tasks.single().title)

        assertEquals(listOf("t1"), Read.threads(JSONObject("""{"threads":[{"id":"t1","title":"A"},{"id":"t1","title":"again"},{"title":"no id"}]}""")).map { it.id })
        assertEquals("idle", Read.threads(JSONObject("""{"threads":[{"id":"t1"}]}"""))[0].state)
        assertEquals(Quiet(true, "22:00", "07:00"), Read.quiet(JSONObject("""{"on":true,"from":"22:00","to":"07:00"}""")))
        assertNull(Read.quiet(JSONObject("""{"on":true,"from":"late","to":"07:00"}""")))
        assertNull(Read.quiet(null))
        assertEquals(listOf("work"), Read.accounts(JSONObject("""{"accounts":[{"id":"work","name":"Work","detail":"a@b.c","note":"","inUse":true},{"name":"no id"}]}""")).map { it.id })
    }
}
