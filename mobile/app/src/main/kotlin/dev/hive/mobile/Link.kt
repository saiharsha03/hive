package dev.hive.mobile

// The sealed link to Hive, the same as Hive's src/main/mobileLink.ts: AES-256-GCM with the key from pairing, a fresh
// 12-byte nonce per message, "<pair>:<dir>" as associated data (p2d = phone to desk, d2p = desk to phone), and a
// counter in every message so an old one replayed by the relay is refused. The relay only ever sees the base64 blob.
import android.content.Context
import android.util.Base64
import org.json.JSONObject
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

object Seal {
    private val random = SecureRandom()

    fun seal(key: ByteArray, pair: String, dir: String, msg: JSONObject): String {
        val nonce = ByteArray(12).also { random.nextBytes(it) }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        c.updateAAD("$pair:$dir".toByteArray())
        val body = c.doFinal(msg.toString().toByteArray()) // ciphertext then the 16-byte tag, as Hive expects
        return Base64.encodeToString(nonce + body, Base64.NO_WRAP)
    }

    fun open(key: ByteArray, pair: String, dir: String, blob: String): JSONObject? = try {
        val b = Base64.decode(blob, Base64.DEFAULT)
        if (b.size < 28) null else {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, b.copyOfRange(0, 12)))
            c.updateAAD("$pair:$dir".toByteArray())
            JSONObject(String(c.doFinal(b, 12, b.size - 12)))
        }
    } catch (e: Exception) { null }
}

// what pairing gave the phone (the QR Hive shows: {v, relay, pair, token, key}), kept in app-private storage
data class Pairing(val relay: String, val pair: String, val token: String, val key: ByteArray) {
    companion object {
        private const val PREFS = "hive"

        fun parse(qr: String): Pairing? = try {
            val j = JSONObject(qr.trim())
            if (j.optInt("v") != 1) null
            else Pairing(j.getString("relay").trimEnd('/'), j.getString("pair"), j.getString("token"), Base64.decode(j.getString("key"), Base64.DEFAULT))
                .takeIf { it.key.size == 32 && it.relay.startsWith("http") }
        } catch (e: Exception) { null }

        fun load(ctx: Context): Pairing? = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("pairing", null)?.let { parse(it) }

        fun save(ctx: Context, qr: String) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("pairing", qr.trim()).putLong("seqIn", 0).remove("seen").apply()

        fun clear(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()

        // Hive's counter: each message (over the socket or in a push) is taken once. The two channels arrive out of order
        // (a push can land after later socket replies, and a notification can come both ways), so it keeps the seq
        // numbers seen within the last WINDOW and refuses repeats and anything older than that
        private const val WINDOW = 500L
        fun takeSeq(ctx: Context, seq: Long): Boolean {
            val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            synchronized(this) {
                val top = p.getLong("seqIn", 0)
                val seen = p.getString("seen", "")!!.split(',').mapNotNull { it.toLongOrNull() }.toMutableSet()
                if (seq <= top - WINDOW || seq in seen) return false
                seen += seq
                val newTop = maxOf(top, seq)
                p.edit().putLong("seqIn", newTop).putString("seen", seen.filter { it > newTop - WINDOW }.joinToString(",")).apply()
                return true
            }
        }

        // the phone's own counter: the clock in ms, always above the last one sent, so nothing needs to be stored
        private var lastOut = 0L
        fun nextSeq(): Long = synchronized(this) { lastOut = maxOf(lastOut + 1, System.currentTimeMillis()); lastOut }
    }

    val ws: String get() = relay.replaceFirst(Regex("^http"), "ws")
}
