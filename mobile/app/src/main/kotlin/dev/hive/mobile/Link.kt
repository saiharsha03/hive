package dev.hive.mobile

// The sealed link to Hive, the same as Hive's src/main/mobileLink.ts: AES-256-GCM with the key from pairing, a fresh
// 12-byte nonce per message, "<pair>:<dir>" as associated data (p2d = phone to desk, d2p = desk to phone, d2n = a
// notification under the notification key), and a counter in every message so an old one replayed by the relay is
// refused. The relay only ever sees the base64 blob.
// Nothing here touches Android, so the unit tests (src/test) run it on the JVM against the same fixture Hive's tests open.
import org.json.JSONObject
import java.net.URI
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

object Seal {
    private val random = SecureRandom()

    fun b64(b: ByteArray): String = Base64.getEncoder().encodeToString(b)
    fun unb64(s: String): ByteArray = Base64.getDecoder().decode(s.trim())

    // The key notifications are sealed with (mobileLink.ts derives the same): a push can be opened with it while the
    // app is locked, and it opens nothing else, so the pairing key itself stays behind the fingerprint.
    fun notifyKey(key: ByteArray): ByteArray = Mac.getInstance("HmacSHA256").run {
        init(SecretKeySpec(key, "HmacSHA256"))
        doFinal("hive-notify-v1".toByteArray(Charsets.UTF_8))
    }

    fun seal(key: ByteArray, pair: String, dir: String, msg: JSONObject): String {
        val nonce = ByteArray(12).also { random.nextBytes(it) }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        c.updateAAD("$pair:$dir".toByteArray(Charsets.UTF_8))
        val body = c.doFinal(msg.toString().toByteArray(Charsets.UTF_8)) // ciphertext then the 16-byte tag, as Hive expects
        return b64(nonce + body)
    }

    // the message, or null when the blob was not sealed with this key for this pair and direction
    fun open(key: ByteArray, pair: String, dir: String, blob: String): JSONObject? = try {
        val b = unb64(blob)
        if (b.size < 28) null else {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, b.copyOfRange(0, 12)))
            c.updateAAD("$pair:$dir".toByteArray(Charsets.UTF_8))
            JSONObject(String(c.doFinal(b, 12, b.size - 12), Charsets.UTF_8))
        }
    } catch (e: Exception) { null }
}

// what pairing gave the phone (the QR Hive shows: {v, relay, pair, token, key})
class Pairing(val relay: String, val pair: String, val token: String, val key: ByteArray) {
    val notifyKey: ByteArray by lazy { Seal.notifyKey(key) }
    val ws: String get() = "wss" + relay.removePrefix("https")

    companion object {
        private val PAIR = Regex("^[a-f0-9]{16,64}$")
        private val TOKEN = Regex("^[A-Za-z0-9_-]{16,256}$")

        // the relay address: https only (the token and every message go to it), a host, and nothing after it but a path
        fun relayOk(relay: String): Boolean = try {
            val u = URI(relay)
            u.scheme == "https" && !u.host.isNullOrEmpty() && u.userInfo == null && u.query == null && u.fragment == null
        } catch (e: Exception) { false }

        // the pairing in a scanned or pasted code, or why it is not one
        fun read(qr: String): Pair<Pairing?, String> {
            val no = "That is not a Hive pairing code"
            val j = try { JSONObject(qr.trim()) } catch (e: Exception) { return null to no }
            if (j.optInt("v") != 1) return null to no
            val relay = j.optString("relay").trimEnd('/')
            val pair = j.optString("pair")
            val token = j.optString("token")
            val key = try { Seal.unb64(j.optString("key")) } catch (e: Exception) { return null to no }
            if (!relay.startsWith("https://")) return null to "The relay address in this code is not https. Set an https relay address in Hive and pair again."
            if (!relayOk(relay)) return null to "The relay address in this code is not valid"
            if (!PAIR.matches(pair) || !TOKEN.matches(token) || key.size != 32) return null to no
            return Pairing(relay, pair, token, key) to ""
        }

        fun parse(qr: String): Pairing? = read(qr).first
    }
}

// What the phone remembers of Hive's counter. Each message (over the socket or in a push) is taken once. The two
// channels arrive out of order (a push can land after later socket replies, and a notification can come both ways), so
// it keeps the seq numbers seen within the last WINDOW and refuses repeats and anything older than that.
data class SeqState(val top: Long = 0, val seen: Set<Long> = emptySet(), val floor: Long = 0)

object Seq {
    const val WINDOW = 500L

    // the state after taking this message, or null when it is a repeat or too old
    fun take(st: SeqState, seq: Long): SeqState? {
        if (seq <= 0 || seq <= st.floor || seq <= st.top - WINDOW || seq in st.seen) return null
        val top = maxOf(st.top, seq)
        return SeqState(top, (st.seen + seq).filter { it > top - WINDOW }.toSet(), st.floor)
    }

    // the phone's own counter: the clock in ms, never at or below the last one sent (kept across restarts, so Hive
    // never sees a number go back); a counter left far ahead by a clock that was wrong and has been corrected starts
    // again from the clock
    fun nextOut(last: Long, now: Long): Long = maxOf((if (last > now + 120_000) 0L else last) + 1, now)
}
