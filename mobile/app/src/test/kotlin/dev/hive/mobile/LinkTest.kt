package dev.hive.mobile

// The sealed link on the JVM. link-fixture.json (src/test/resources) is the one file both sides open: Orbit's tests
// (test/relay/linkFixture.test.ts) with mobileLink.ts, these with Link.kt. Its "cases" and "bad" were sealed by Orbit,
// its "fromApp" by this code (run the tests with HIVE_LINK_FIXTURE_OUT=<file> to seal a fresh set).
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.math.BigDecimal

class LinkTest {
    private val fx = JSONObject(javaClass.getResource("/link-fixture.json")!!.readText())
    private val key = Seal.unb64(fx.getString("key"))
    private val pair = fx.getString("pair")

    private fun keyOf(c: JSONObject) = if (c.optString("key") == "notify") Seal.notifyKey(key) else key
    private fun each(name: String): List<JSONObject> = fx.getJSONArray(name).let { a -> (0 until a.length()).map { a.getJSONObject(it) } }

    // the same JSON whatever the key order or number type (1 and 1.0, Int and Long)
    private fun norm(v: Any?): Any? = when (v) {
        is JSONObject -> v.keys().asSequence().toList().sorted().associateWith { norm(v.get(it)) }
        is JSONArray -> (0 until v.length()).map { norm(v.get(it)) }
        is Number -> BigDecimal(v.toString()).stripTrailingZeros().toPlainString()
        else -> v
    }

    @Test fun theNotificationKeyIsDerivedAsHiveDoes() {
        assertEquals(fx.getString("notifyKey"), Seal.b64(Seal.notifyKey(key)))
        assertFalse(Seal.notifyKey(key).contentEquals(key))
    }

    @Test fun blobsSealedByHiveOpen() {
        val cases = each("cases")
        assertTrue(cases.size >= 3)
        for (c in cases) {
            val m = Seal.open(keyOf(c), pair, c.getString("dir"), c.getString("blob"))
            assertNotNull(c.getString("name"), m)
            assertEquals(c.getString("name"), norm(c.getJSONObject("msg")), norm(m))
        }
    }

    @Test fun aChangedCutMisdirectedOrWronglyKeyedBlobDoesNotOpen() {
        val bad = each("bad")
        assertTrue(bad.size >= 10)
        for (c in bad) assertNull(c.getString("name"), Seal.open(keyOf(c), pair, c.getString("dir"), c.getString("blob")))
    }

    @Test fun whatThisAppSealedForTheFixtureStillOpens() {
        val mine = each("fromApp")
        assertTrue("the fixture has no blob sealed by the app", mine.size >= 2)
        for (c in mine) assertEquals(c.getString("name"), norm(c.getJSONObject("msg")), norm(Seal.open(keyOf(c), pair, c.getString("dir"), c.getString("blob"))))
    }

    @Test fun sealThenOpenWithAFreshNonceEachTime() {
        val msg = JSONObject().put("op", "send").put("text", "héllo 漢字 🙂 \"q\" / \\ \n").put("seq", 1700000000002L)
        val a = Seal.seal(key, pair, "p2d", msg)
        val b = Seal.seal(key, pair, "p2d", msg)
        assertFalse(a == b)
        assertEquals(norm(msg), norm(Seal.open(key, pair, "p2d", a)))
        assertNull(Seal.open(key, pair, "d2p", a)) // never in the other direction
        assertNull(Seal.open(Seal.notifyKey(key), pair, "p2d", a)) // nor with the notification key
        assertNull(Seal.open(key, pair.reversed(), "p2d", a)) // nor for another pair
        assertEquals(50, (1..50).map { Seal.seal(key, pair, "p2d", msg).take(16) }.toSet().size)
    }

    // not a check: writes blobs sealed by this code, for Orbit's tests to open (they are then pasted into the fixture)
    @Test fun sealForTheFixture() {
        val out = System.getenv("HIVE_LINK_FIXTURE_OUT") ?: return
        val request = JSONObject().put("op", "send").put("id", "t1").put("text", "héllo 漢字 🙂 \"q\" / \\ \n").put("mid", "a1b2c3").put("rid", 1700000000002L).put("seq", 1700000000002L)
        val hello = JSONObject().put("op", "hello").put("v", 2).put("rid", 1700000000003L).put("seq", 1700000000003L)
        val rows = JSONArray()
            .put(JSONObject().put("name", "a send sealed by the app").put("dir", "p2d").put("key", "pair").put("blob", Seal.seal(key, pair, "p2d", request)).put("msg", request))
            .put(JSONObject().put("name", "hello sealed by the app").put("dir", "p2d").put("key", "pair").put("blob", Seal.seal(key, pair, "p2d", hello)).put("msg", hello))
        File(out).writeText(rows.toString())
    }

    private fun qr(relay: String = "https://relay.example.com/", pairId: String = pair, token: String = "t".repeat(43), keyB64: String = fx.getString("key"), v: Int = 1) =
        JSONObject().put("v", v).put("relay", relay).put("pair", pairId).put("token", token).put("key", keyB64).toString()

    @Test fun aPairingCodeIsReadAndChecked() {
        val p = Pairing.parse("  " + qr() + "\n")!!
        assertEquals("https://relay.example.com", p.relay) // the trailing slash is dropped
        assertEquals("wss://relay.example.com", p.ws)
        assertArrayEquals(key, p.key)
        assertArrayEquals(Seal.notifyKey(key), p.notifyKey)
        assertEquals("wss://hive.example.com/relay", Pairing.parse(qr(relay = "https://hive.example.com/relay"))!!.ws)

        // https only: the token and every message go to that address
        for (relay in listOf("http://relay.example.com", "httpx://relay.example.com", "ws://relay.example.com", "relay.example.com", "https://", "https://user:pw@relay.example.com", "https://relay.example.com/?x=1", "")) {
            assertNull(relay, Pairing.parse(qr(relay = relay)))
        }
        assertTrue(Pairing.read(qr(relay = "http://relay.example.com")).second.contains("https"))
        // the pair id is lowercase hex and goes into the address as it is
        for (id in listOf("", "abc", "ZZ112233445566778899aabbccddeeff", "00112233445566778899aabbccddeeff&role=desk", "0011 2233445566778899aabbccddeeff")) {
            assertNull(id, Pairing.parse(qr(pairId = id)))
        }
        assertNull(Pairing.parse(qr(token = "")))
        assertNull(Pairing.parse(qr(token = "has space and\nnewline in it")))
        assertNull(Pairing.parse(qr(keyB64 = Seal.b64(ByteArray(16))))) // not a 256-bit key
        assertNull(Pairing.parse(qr(keyB64 = "not base64!")))
        assertNull(Pairing.parse(qr(v = 2)))
        assertNull(Pairing.parse("hello"))
        assertNull(Pairing.parse("[1,2]"))
    }

    @Test fun eachMessageFromHiveIsTakenOnce() {
        var st = SeqState()
        fun take(seq: Long): Boolean { val n = Seq.take(st, seq) ?: return false; st = n; return true }
        assertFalse(take(0)) // a message without a counter
        assertFalse(take(-5))
        assertTrue(take(1))
        assertFalse(take(1)) // the relay replays it
        assertTrue(take(3))
        assertTrue(take(2)) // a push that lands after a later socket reply
        assertFalse(take(2))
        assertFalse(take(3))
        assertTrue(take(1000))
        assertFalse(take(500)) // older than the window: it cannot be known whether it was seen
        assertTrue(take(501))
        assertFalse(take(501))
        assertTrue(st.seen.size <= Seq.WINDOW) // the list does not grow
        for (s in 1001L..3000L) assertTrue(take(s))
        assertTrue(st.seen.size <= Seq.WINDOW)
        assertFalse(take(2400))
        // a record from before the seen list: nothing at or below its floor is ever taken
        st = SeqState(top = 70, floor = 70)
        assertFalse(take(70))
        assertFalse(take(12))
        assertTrue(take(71))
    }

    @Test fun thePhonesOwnCounterNeverGoesBack() {
        val now = 1_700_000_000_000L
        assertEquals(now, Seq.nextOut(0, now)) // the clock
        assertEquals(now + 1, Seq.nextOut(now, now)) // two in the same millisecond
        assertEquals(now + 51, Seq.nextOut(now + 50, now)) // the clock went back a little
        assertEquals(now + 90_001, Seq.nextOut(now + 90_000, now))
        assertEquals(now, Seq.nextOut(now + 3_600_000, now)) // left an hour ahead by a wrong clock: from the clock again
        var last = 0L
        repeat(1000) { val n = Seq.nextOut(last, now); assertTrue(n > last); last = n }
    }
}
