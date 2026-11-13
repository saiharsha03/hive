package dev.hive.mobile

// Where the pairing is kept on the phone, in two parts, both under keys that live in the Android Keystore (they never
// leave this phone: not in a backup, not in a transfer to a new phone, not in a copy of the app's files):
//
// - the pairing key (it seals every request to Orbit) is wrapped by an RSA key that the Keystore lets work only after
//   the fingerprint or the screen lock: the prompt that opens the app is what releases it (a CryptoObject), so there
//   is no check in the app's own code to step around. Wrapping needs only the public half, so pairing asks nothing.
// - the relay address, the pair id, the relay token and the notification key are wrapped by an AES key without that
//   condition, so a push can be opened and the push token registered while the app is closed. They show
//   notifications; they cannot make a request to Orbit.
//
// Android 10 cannot release a key through the screen-lock screen, so there the RSA key works for 30 seconds after any
// fingerprint or screen-lock check instead (still the Keystore's rule, not the app's).
import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONObject
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.PublicKey
import java.security.spec.MGF1ParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource

// what the app can read without the fingerprint
class Known(val relay: String, val pair: String, val token: String, val notifyKey: ByteArray)

object Vault {
    private const val PREFS = "hive"
    private const val KEYSTORE = "AndroidKeyStore"
    private const val OPEN_KEY = "hive-open"
    private const val AUTH_KEY = "hive-auth"
    private const val RSA = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding"
    // the Keystore's OAEP uses SHA-1 inside MGF1 whatever the main digest; say so on both sides or they disagree
    private val OAEP = OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT)

    // the whole pairing, in memory only, between unlocking and locking
    @Volatile var session: Pairing? = null
        private set
    // when the app left the screen (elapsedRealtime), 0 while it is on it: two minutes away locks it
    @Volatile var hiddenAt = 0L

    @Volatile private var known: Known? = null
    @Volatile private var knownRead = false

    private fun prefs(ctx: Context): SharedPreferences = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun keystore(): KeyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    private fun openKey(): SecretKey {
        (keystore().getKey(OPEN_KEY, null) as SecretKey?)?.let { return it }
        val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        g.init(KeyGenParameterSpec.Builder(OPEN_KEY, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
        return g.generateKey()
    }

    // a new key pair for the pairing key; throws when the phone has no screen lock (the Keystore refuses such a key)
    private fun newAuthKey(): PublicKey {
        runCatching { keystore().deleteEntry(AUTH_KEY) }
        val spec = KeyGenParameterSpec.Builder(AUTH_KEY, KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(2048)
            .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA1)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
            .setUserAuthenticationRequired(true)
            // the screen lock opens it as well, so a newly added fingerprint gives nobody anything new
            .setInvalidatedByBiometricEnrollment(false)
        if (Build.VERSION.SDK_INT >= 30) spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
        else @Suppress("DEPRECATION") spec.setUserAuthenticationValidityDurationSeconds(30)
        val g = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, KEYSTORE)
        g.initialize(spec.build())
        return g.generateKeyPair().public
    }

    // ---- what is readable without the fingerprint ----
    fun known(ctx: Context): Known? {
        if (knownRead) return known
        synchronized(this) {
            if (knownRead) return known
            known = try {
                val b = Seal.unb64(prefs(ctx).getString("open", null) ?: "")
                val c = Cipher.getInstance("AES/GCM/NoPadding")
                c.init(Cipher.DECRYPT_MODE, openKey(), GCMParameterSpec(128, b.copyOfRange(0, 12)))
                val j = JSONObject(String(c.doFinal(b, 12, b.size - 12), Charsets.UTF_8))
                Known(j.getString("relay"), j.getString("pair"), j.getString("token"), Seal.unb64(j.getString("nk")))
            } catch (e: Exception) { null }
            knownRead = true
            return known
        }
    }

    fun isPaired(ctx: Context): Boolean = known(ctx) != null && prefs(ctx).contains("locked")

    // a pairing saved by an earlier version of the app, as plain text: moved into the Keystore at the next unlock
    fun hasLegacy(ctx: Context): Boolean = !isPaired(ctx) && prefs(ctx).contains("pairing")

    fun migrate(ctx: Context) {
        val old = prefs(ctx).getString("pairing", null)?.let { Pairing.parse(it) }
        if (old == null) prefs(ctx).edit().remove("pairing").commit() // not one this version takes (no https): pair again
        else save(ctx, old)
    }

    // ---- pairing, unlocking, locking ----
    // Stores a new pairing and leaves the app unlocked with it. Throws when the phone has no screen lock.
    fun save(ctx: Context, p: Pairing) {
        val pub = newAuthKey()
        // through a plain (software) key object, so the Keystore is not asked for a fingerprint to use the public half
        val plain = KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(pub.encoded))
        val locked = Cipher.getInstance(RSA).run { init(Cipher.ENCRYPT_MODE, plain, OAEP); doFinal(p.key) }
        val body = JSONObject().put("relay", p.relay).put("pair", p.pair).put("token", p.token).put("nk", Seal.b64(p.notifyKey))
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, openKey())
        val open = c.iv + c.doFinal(body.toString().toByteArray(Charsets.UTF_8))
        val e = prefs(ctx).edit().remove("pairing").putString("open", Seal.b64(open)).putString("locked", Seal.b64(locked))
        // Orbit's counter starts again only with another pairing: scanning the same code twice must not let the relay
        // replay what this phone has already taken
        if (prefs(ctx).getString("seqPair", null) != p.pair) e.putString("seqPair", p.pair).putLong("seqIn", 0).putString("seen", "").putLong("floor", 0)
        if (!e.commit()) throw IllegalStateException("could not save the pairing")
        known = Known(p.relay, p.pair, p.token, p.notifyKey)
        knownRead = true
        session = p
    }

    // The cipher that unwraps the pairing key. On Android 11 and up it does nothing until the prompt it is handed to
    // (BiometricPrompt.CryptoObject) succeeds; on Android 10 creating it fails unless the fingerprint or screen lock
    // was checked in the last 30 seconds. Throws KeyPermanentlyInvalidatedException when the screen lock was removed.
    fun unlockCipher(): Cipher {
        val key = keystore().getKey(AUTH_KEY, null) as PrivateKey? ?: throw IllegalStateException("the pairing key is gone")
        return Cipher.getInstance(RSA).apply { init(Cipher.DECRYPT_MODE, key, OAEP) }
    }

    fun open(ctx: Context, cipher: Cipher) {
        val k = known(ctx) ?: throw IllegalStateException("not paired")
        val key = cipher.doFinal(Seal.unb64(prefs(ctx).getString("locked", null) ?: ""))
        if (key.size != 32) throw IllegalStateException("not a pairing key")
        session = Pairing(k.relay, k.pair, k.token, key)
    }

    fun lock() { session = null }

    // forgets the pairing; the counters are kept (see save; the phone's own never goes back)
    fun clear(ctx: Context) {
        session = null
        prefs(ctx).edit().remove("pairing").remove("open").remove("locked").commit()
        runCatching { keystore().deleteEntry(AUTH_KEY) }
        runCatching { keystore().deleteEntry(OPEN_KEY) }
        known = null
        knownRead = true
    }

    // ---- the counters (not secret) ----
    // true when this message from Orbit is new; written before it is used, so a restart cannot take it twice
    fun takeSeq(ctx: Context, seq: Long): Boolean = synchronized(this) {
        val p = prefs(ctx)
        val top = p.getLong("seqIn", 0)
        // a record from before the seen list: its high-water mark becomes a permanent floor
        val floor = if (!p.contains("seen") && !p.contains("floor")) top else p.getLong("floor", 0)
        val seen = (p.getString("seen", "") ?: "").split(',').mapNotNull { it.toLongOrNull() }.toSet()
        val next = Seq.take(SeqState(top, seen, floor), seq) ?: return false
        p.edit().putLong("seqIn", next.top).putString("seen", next.seen.joinToString(",")).putLong("floor", next.floor).commit()
    }

    fun nextSeq(ctx: Context): Long = synchronized(this) {
        val p = prefs(ctx)
        val next = Seq.nextOut(p.getLong("lastOut", 0), System.currentTimeMillis())
        p.edit().putLong("lastOut", next).commit()
        next
    }
}

// What the user chose on this phone (nothing secret): quiet hours, and whether notifications carry answer buttons.
object Settings {
    private fun prefs(ctx: Context): SharedPreferences = ctx.getSharedPreferences("hive-settings", Context.MODE_PRIVATE)

    fun quiet(ctx: Context): Quiet = prefs(ctx).let { Quiet(it.getBoolean("quietOn", false), it.getString("quietFrom", null) ?: "22:00", it.getString("quietTo", null) ?: "07:00") }
    fun setQuiet(ctx: Context, q: Quiet) { prefs(ctx).edit().putBoolean("quietOn", q.on).putString("quietFrom", q.from).putString("quietTo", q.to).apply() }
    fun buttons(ctx: Context): Boolean = prefs(ctx).getBoolean("buttons", true)
    fun setButtons(ctx: Context, on: Boolean) { prefs(ctx).edit().putBoolean("buttons", on).apply() }
}
