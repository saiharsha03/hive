package dev.hive.mobile

// Changes.kt's reading of Orbit's changes, diff and merge replies, on the JVM
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChangesTest {
    private val sha = "a".repeat(40)
    private val reply = """
        {"branch":"feat/x","upstream":"origin/feat/x","ahead":2,"behind":0,"more":0,"note":"","prUnavailable":"",
         "files":[{"path":"src/a.ts","add":3,"del":1,"binary":false,"area":"branch"},{"path":"img.png","add":0,"del":0,"binary":true,"area":"untracked"},{"path":"","area":"branch"}],
         "pr":{"repo":"o/r","defaultBranch":"main","method":"squash","block":null,
               "pr":{"number":12,"url":"u","title":"Add x","state":"OPEN","isDraft":false,"headRefOid":"$sha","baseRefName":"main","checks":{"state":"passing"},"checksText":"1 of 1 passed"}}}
    """.trimIndent()

    @Test fun readsTheBranchFilesAndPr() {
        val c = ReadChanges.changes(JSONObject(reply))!!
        assertEquals("feat/x", c.branch)
        assertEquals(2, c.ahead)
        assertEquals(listOf("src/a.ts", "img.png"), c.files.map { it.path })
        assertTrue(c.files[1].binary)
        assertEquals("untracked", c.files[1].area)
        val p = c.pr!!
        assertEquals(12, p.number)
        assertEquals("", p.block) // JSON null is not the word "null"
        assertEquals("passing", p.checks)
        assertTrue(ReadChanges.allowed(p))
    }

    @Test fun aBlockedOrMissingPrIsNotMergeable() {
        val blocked = JSONObject(reply.replace("\"block\":null", "\"block\":\"It is behind the base branch: update it first.\""))
        assertFalse(ReadChanges.allowed(ReadChanges.changes(blocked)!!.pr!!))
        val noPr = JSONObject(reply).put("pr", JSONObject.NULL)
        assertNull(ReadChanges.changes(noPr)!!.pr)
        assertEquals("", ReadChanges.changes(noPr)!!.prUnavailable)
        assertNull(ReadChanges.changes(null))
    }

    @Test fun readsDiffsAndMergeAnswers() {
        val d = ReadChanges.diff(JSONObject("""{"text":"@@ -1 +1 @@\n-a\n+b","totalLines":3,"shown":3,"truncated":false}"""))
        assertEquals(listOf("hunk", "del", "add"), d.text.split('\n').map { ReadChanges.lineKind(it) })
        assertEquals("meta", ReadChanges.lineKind("+++ b/src/a.ts"))
        assertEquals("note", ReadChanges.lineKind("… truncated, 6 more lines"))
        assertEquals(true to "Merged #12 (squash).", ReadChanges.merge(JSONObject("""{"ok":true,"number":12,"method":"squash"}""")))
        assertEquals(false to "Its checks are failing.", ReadChanges.merge(JSONObject("""{"ok":false,"reason":"Its checks are failing."}""")))
    }
}
