package dev.hive.mobile

// Every screen drawn to a PNG on the JVM, no phone or emulator: Robolectric runs the same Compose code the app
// shows (Screens.kt), Roborazzi saves the picture to build/shots/. The content is invented. Run:
//   ./gradlew :app:testDebugUnitTest --tests "*ScreensTest*"
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.time.Instant
import java.util.TimeZone

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w360dp-h760dp-xhdpi")
class ScreensTest {
    private val now = Instant.parse("2026-11-09T13:27:00Z").toEpochMilli()
    private fun at(hhmm: String, day: String = "2026-11-09") = Instant.parse("${day}T$hhmm:00Z").toEpochMilli()
    private fun ago(min: Long) = now - min * 60_000
    private val counts = Counts(needs = 3, threads = 8, running = 5, scheduled = 5)

    @Before fun utc() { TimeZone.setDefault(TimeZone.getTimeZone("UTC")) }

    private fun shot(name: String, tab: Int? = null, content: @Composable () -> Unit) = captureRoboImage("build/shots/phone-$name.png") {
        HiveTheme {
            Column(Modifier.fillMaxSize().background(C.bg)) {
                Box(Modifier.weight(1f)) { content() }
                if (tab != null) Tabs(counts, tab) { }
            }
        }
    }

    private val wakes = listOf(
        Wake("wake", "41", "s-ship", "Ship ledger-web 4.18", at("14:00"), "Promote to prod when the freeze ends", null),
        Wake("wake", "42", "s-ship", "Ship ledger-web 4.18", at("14:30"), "Check the prod landed check and the 5xx rate", null),
        Wake("wake", "43", "s-inv", "Fix duplicate invoice numbers", at("13:37"), "/loop 10m check CI on fix/invoice-retry", 10),
        Wake("continue", "s-drafts", "s-drafts", "Android app drops drafts on relock", at("15:00"), "Continue after the usage limit resets", null),
        Wake("wake", "44", "s-pay", "Payout reconciliation", at("09:00", "2026-11-10"), "Compare payouts with the bank file", null),
    )

    @Test fun inbox() = shot("inbox", 0) {
        InboxScreen(Inbox(listOf(
            Need("waiting", "t-ship", "Ship ledger-web 4.18 to prod", "Promote now or after the 14:00 freeze?", ago(6), "a1", "Promote ledger-web 4.18 to prod?", listOf("Wait to 14:00", "Promote now", "Show me the 14 commits first")),
            Need("waiting", "t-sweep", "Nightly error sweep", "502s on /v2/payouts since 02:10, 1.8% of calls. Start a thread on it?", ago(41)),
            Need("failed", "t-node", "Bump node to 22 in CI images", "docker build failed at step 7 of 12", ago(183)),
        ), wakes.take(2) + wakes[3], counts), now)
    }

    @Test fun threads() = shot("threads", 1) {
        ThreadsScreen(listOf(
            ThreadRow("t-ship", "Ship ledger-web 4.18 to prod", "ledger-web", "waiting", "Promote now or after the 14:00 freeze?", ago(6), "waiting"),
            ThreadRow("t-sweep", "Nightly error sweep", "ledger-api", "waiting", "next run 02:00", ago(41), "watchers"),
            ThreadRow("t-inv", "Fix duplicate invoice numbers", "ledger-api", "working", "", ago(1), "working"),
            ThreadRow("t-exp", "Report exports team", "reports", "working", "", ago(2), "working"),
            ThreadRow("t-sync", "Offline sync spike", "ledger-android", "working", "", ago(4), "working"),
            ThreadRow("t-drafts", "Android app drops drafts on relock", "ledger-android", "idle", "", ago(95), "pinned", continues = at("15:00")),
            ThreadRow("t-node", "Bump node to 22 in CI images", "infra", "idle", "", ago(183), "recent"),
            ThreadRow("t-pay", "Payout reconciliation", "ledger-api", "idle", "", ago(300), "recent", wakes = at("14:00")),
            ThreadRow("t-csv", "CSV export loses the header row", "reports", "idle", "", ago(60 * 26), "recent"),
        ), now, drafts = setOf("t-drafts"))
    }

    private val shipThread = ThreadView(
        "Ship ledger-web 4.18 to prod",
        listOf(
            Item("you", "Ship 4.18 to staging, wait for the landed check, then ask me before prod.", seen = true),
            Item("tool", "Bash ./deploy.sh ledger-web staging 4.18.0"),
            Item("claude", "Staging is on 4.18.0 and the landed check passed at 13:36. 14 commits will ship to prod, none touch payments or auth."),
        ),
        working = false,
        asks = listOf(Ask("a1", listOf(Question("Promote ledger-web 4.18 to prod?", "", listOf(Choice("Promote now", ""), Choice("Wait for the freeze, promote at 14:00", ""), Choice("Show me the 14 commits first", "")), false)))),
    )

    @Test fun thread() = shot("thread") { ThreadScreen(shipThread, draft = "") }
    private val more = ThreadMore(112_000, 1_000_000, "Waiting on a review: Reviewer: check the retry path",
        listOf(Work("t1", "Subagent", true, "Reviewer: check the retry path", "Reading billing/webhooks.py", 1_700_000_000_000, 48_000, "reviewer", "claude-fable-5-2", "Review the retry change in billing/invoice.py for races and missing tests."),
            Work("t2", "Shell", false, "Run the billing tests", "pytest tests/billing", 1_700_000_000_000, 0, "", "", "pytest tests/billing -q")),
        listOf(Point("u1", "Use a unique constraint, not a lookup", 1_700_000_000_000)), true, "claude-fable-5-2",
        Gate("a91f3c2", "fix/invoice-retry", 9, 16, true, listOf(GateItem("K1", "Scoping", "PASS"), GateItem("K7", "Tests prove the fix", ""))))
    @Test fun threadWork() = shot("thread-work") { ThreadScreen(shipThread, draft = "", more = more, morePane = "work", now = 1_700_000_030_000,
        settings = ThreadSettings(true, "bypassPermissions", "claude-opus-5-5", "high", advisor = "claude-fable-5-2")) }
    @Test fun threadGate() = shot("thread-gate") { ThreadScreen(shipThread, draft = "", more = more, morePane = "gate", now = 1_700_000_030_000) }

    @Test fun threadWorking() = shot("thread-working") {
        ThreadScreen(ThreadView(
            "Fix duplicate invoice numbers",
            listOf(
                Item("you", "The retry path can create two invoices with the same number. Find it and fix it, with a test.", seen = true),
                Item("claude", "The migration adds `UniqueConstraint(payment, retry_key)` and the create path returns the row that won."),
                Item("tool", "Edit billing/webhooks.py"),
                Item("tool", "Bash pytest tests/billing -x -q"),
                Item("you", "Also cover the refund path.", seen = false),
            ),
            working = true,
            tasks = listOf(Task("b1", "Shell", "pytest tests/billing -x -q", "test_second_retry_returns_same_invoice PASSED")),
        ), draft = "when tests pass open a draft PR and ask the reviewer to look")
    }

    @Test fun running() = shot("running", 2) {
        RunningScreen(listOf(
            RunRow("t-inv", "Fix duplicate invoice numbers", "a1", "Subagent", "Reviewer: check the retry path for races", "Reading billing/webhooks.py, line 140", "working"),
            RunRow("t-inv", "Fix duplicate invoice numbers", "b1", "Shell", "pytest tests/billing -x -q", "test_second_retry_returns_same_invoice PASSED", "working"),
            RunRow("t-ship", "Ship ledger-web 4.18", "m1", "Monitor", "Tail staging logs for 5xx", "0 errors in the last 5 minutes", "working"),
            RunRow("t-exp", "Report exports team", "a2", "Subagent", "Builder 2: port the CSV writer to the job queue", "Edit reports/csv_writer.py +44 -19", "working"),
            RunRow("t-exp", "Report exports team", "c1", "Codex", "Write the export_jobs migration", "Running makemigrations --check", "working"),
        ), threads = 4, scheduled = 5)
    }

    @Test fun stopAll() = shot("stop", 4) { MoreScreen(stopAll = false, canPause = true, threads = 4, tasks = 6, scheduled = 5, accounts = true) }

    @Test fun more() = shot("more", 4) { MoreScreen(accounts = true) }

    @Test fun scheduled() = shot("wake", 3) { ScheduledScreen(wakes, now, canRun = true) }

    @Test fun usage() = shot("usage") {
        UsageScreen(listOf(
            Limit("five_hour", "Current session (5 hours)", 78.0, "2026-11-09T15:00:00Z"),
            Limit("seven_day", "Current week (all models)", 41.0, "2026-11-12T09:00:00Z"),
            Limit("seven_day_opus", "Current week (Opus)", 28.0, "2026-11-12T09:00:00Z"),
        ), now, plan = "Max", accounts = listOf(
            Account("work", "Work", "orin@tallgrass.dev, 5h 78%", "", true),
            Account("personal", "Personal", "orin@quietharbor.dev, 5h 8%", "Pro", false),
            Account("bot", "Build bot", "API key, tallgrass-ci", "Console", false),
        ))
    }

    @Test fun usageGuard() = shot("usage-guard") {
        UsageScreen(listOf(
            Limit("five_hour", "Current session (5 hours)", 92.0, "2026-11-09T15:00:00Z"),
            Limit("seven_day", "Current week (all models)", 41.0, "2026-11-12T09:00:00Z"),
        ), now, plan = "Max", working = 4, wakes = wakes)
    }

    @Test fun teams() = shot("teams") {
        TeamsScreen(listOf(Team("team1", "Report exports team", "Move every export to the job queue. Board 5 of 9 done.", "WORKING", listOf(
            Member("t-lead", "Re-queueing PDF exports", "lead", "working"),
            Member("t-b1", "Move PDF exports", "builder 1", "failed"),
            Member("t-b2", "Port the CSV writer", "builder 2", "working"),
            Member("t-rev", "Waiting for Builder 2", "reviewer", "waiting"),
        ), listOf(Post("Lead", "PDF item is back in the queue, Builder 1 hit an edit refusal."), Post("Builder 2", "CSV writer passes 12 of 14 tests."), Post("Reviewer", "I want a backfill plan for export_jobs before this lands.")))))
    }

    @Test fun newThread() = shot("new") {
        NewThreadScreen(listOf("C:\\work\\ledger", "C:\\work\\ledger\\ledger-api", "C:\\work\\ledger\\ledger-web", "C:\\work\\ledger\\ledger-android", "C:\\work\\ledger\\reports"), "C:\\work\\ledger\\ledger-api",
            "Find why the payout webhook returns 502 since 02:10 and propose a fix. Don't deploy.")
    }

    @Test fun settings() = shot("settings") { SettingsScreen(Quiet(true, "22:00", "07:00"), buttons = true, relay = "relay.tallgrass.dev", linkWord = "online", clock = "clock within 0.4 s", syncs = true, version = "2.0") }

    @Test fun settingsUnpair() = shot("settings-unpair") { SettingsScreen(Quiet(false, "22:00", "07:00"), buttons = true, relay = "relay.tallgrass.dev", linkWord = "online", clock = "clock within 0.4 s", unpair = true) }

    @Test fun pair() = shot("pair") { PairScreen(paste = true, text = "") }

    @Test fun locked() = shot("locked") { LockedScreen() }

    // the launcher icon as a square launcher shows it: the adaptive icon's two layers, full size
    @Test fun icon() = captureRoboImage("build/shots/phone-icon.png") {
        Box(Modifier.size(108.dp).background(Color(0xFF1C1F23))) { Image(painterResource(R.drawable.ic_launcher_foreground), contentDescription = null, modifier = Modifier.fillMaxSize()) }
    }

    @Test fun offline() = shot("inbox-offline", 0) { InboxScreen(Inbox(), now, notice = "The computer is offline (Hive is closed or asleep).") }
}
