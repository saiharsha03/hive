// Watcher threads are read-only (on request): this is the pure part. A shell command that writes to a company system is
// refused (gh writes, git push, HTTP writes from curl or PowerShell); Python is covered by the guard below, Postgres by
// PGOPTIONS. Not airtight (a script can find another way), but it stops the ordinary ways of writing.

export const isWatcherTab = (tabId: string) => tabId.startsWith('watcher-')
// A watcher session, whatever tab resumes it (sidebar, phone, message_thread, after a restart): its first message is
// Hive's run header "[<app> watcher run: <name>]" or a wake-up "[<app> wake-up: <name>]". jsonl = the transcript's start;
// null = no complete first user message in it yet (read more, or treat as a watcher's: fail closed)
// the first line of a watcher run header or wake-up: "[<app> watcher run: <name>]" / "[<app> wake-up: <name>]"
// That shape depends on the app's name (a name with "]" in it never matched, and the session was then resumed
// writable), so every header now starts with WATCHER_MARK, which does not. The old shape is still read: transcripts
// written before the mark stay read-only.
export const WATCHER_MARK = '[hive:watcher]'
export const WATCHER_HEADER = /^\[[^\]\n]{1,80} (watcher run|wake-up): [^\]\n]+\]/
export const isWatcherStart = (text: string) => text.startsWith(WATCHER_MARK) || WATCHER_HEADER.test(text)
// a name as it is written inside a "[...]" header: no brackets, one line
export const headerName = (name: string) => name.replace(/\[/g, '(').replace(/\]/g, ')').replace(/\s*[\r\n]+\s*/g, ' ').trim()
export function isWatcherTranscript(jsonl: string): boolean | null {
  for (const line of jsonl.split('\n')) {
    if (!line.startsWith('{')) continue
    let e: any
    try { e = JSON.parse(line) } catch { continue }
    if (e.type !== 'user' || e.isMeta) continue
    const c = e.message?.content
    const text = typeof c === 'string' ? c : Array.isArray(c) ? (c.find((p: any) => p?.type === 'text')?.text ?? '') : ''
    if (!text) continue
    return isWatcherStart(text)
  }
  return null
}

const GH_WRITES: Record<string, RegExp> = {
  pr: /^(create|merge|close|comment|edit|review|ready|reopen|lock|unlock|update-branch|revert)$/,
  issue: /^(create|close|comment|edit|delete|reopen|transfer|pin|unpin|lock|unlock|develop)$/,
  release: /^(create|delete|edit|upload|delete-asset)$/,
  repo: /^(create|delete|edit|fork|rename|archive|unarchive|sync|set-default)$/,
  workflow: /^(run|enable|disable)$/,
  run: /^(rerun|cancel|delete)$/,
  label: /^(create|edit|delete|clone)$/,
  secret: /^(set|delete|remove)$/,
  variable: /^(set|delete|remove)$/,
  gist: /^(create|edit|delete|rename|clone)$/,
  project: /^(create|delete|edit|close|copy|link|unlink|mark-template|item-add|item-create|item-edit|item-delete|item-archive|field-create|field-delete)$/,
  cache: /^delete$/,
  'ssh-key': /^(add|delete)$/,
  'gpg-key': /^(add|delete)$/,
  codespace: /^(create|delete|edit|rebuild|stop)$/,
}

// `git push` with any of git's own options before the command: git -C <dir> push, git -c k=v push, git --no-pager push
const GIT_PUSH = /(^|[\s\\/"'(])git(\.exe)?["']?\s+(?:(?:-[cC]|--git-dir|--work-tree|--namespace)(?:\s+|=)(?:[^\s"']|"[^"]*"|'[^']*')+\s+|--?[\w-]+(?:=(?:[^\s"']|"[^"]*"|'[^']*')+)?\s+)*push\b/i

// the reason a command is refused in a read-only thread, or null when it may run
export function blockedCommand(cmd: string): string | null {
  for (const part of cmd.split(/&&|\|\||;|\||\n/)) {
    // quotes, grouping and a full path do not hide the program: "gh", (gh ...), C:\bin\gh.exe (only its name is reduced)
    const w = part.replace(/["'()`{}]/g, ' ').trim().split(/\s+/)
    const at = w.findIndex((x) => /^gh(\.exe)?$/i.test(x.split(/[\\/]/).pop() ?? x))
    if (at >= 0) {
      // the command and its verb are the first two words that are not flags: gh pr -R owner/repo merge 5 is a merge
      const words: number[] = []
      for (let i = at + 1; i < w.length && words.length < 2; i++) {
        if (/^(-R|--repo|--hostname)$/.test(w[i])) i++ // its value follows
        else if (!w[i].startsWith('-')) words.push(i)
      }
      const [sub, verb] = [w[words[0]] ?? '', w[words[1]] ?? '']
      if (GH_WRITES[sub]?.test(verb)) return `gh ${sub} ${verb} writes to GitHub`
      if (sub === 'api') {
        const args = w.slice(words[0] + 1)
        // every -X / --method value (gh uses the last one); any that is not GET means a write
        // -X POST, -XPOST, -X=POST, bundled -iXPOST, --method POST, --method=POST
        const methods = args.flatMap((x, i) => {
          const m = x.match(/^-[a-zA-Z]*X=?(\w*)$/) ?? x.match(/^--method(?:=(\w*))?$/i)
          return m ? [(m[1] || args[i + 1] || '').toUpperCase()] : []
        })
        const bad = methods.find((m) => m !== 'GET')
        if (bad !== undefined) return `gh api ${bad || 'with a method'} writes to GitHub`
        // any field or input flag, attached value or not (-ftitle=x, --field=x, --input=f), or an @file
        const body = args.some((x) => /^(-[a-zA-Z]*[fF]|--field|--raw-field|--input)/.test(x) || x.startsWith('@'))
        if (args.includes('graphql') ? args.some((x) => /mutation/i.test(x)) : body && !methods.length) return 'gh api with a body writes to GitHub'
      }
    }
    if (GIT_PUSH.test(part)) return 'git push writes to a remote'
    if (/(^|\s)curl(\.exe)?\s/i.test(` ${part}`)) {
      const m = part.match(/(?:-X|--request)[\s=]*['"]?(\w+)/)?.[1]?.toUpperCase()
      // a data flag, its value attached or not: -d x, -d'x', -d@file, -sd x, --data-raw=x, -F, -T, --json
      if ((m && !['GET', 'HEAD', 'OPTIONS'].includes(m)) || /(^|\s)(-[A-Za-z]*[dFT]\S*|--data[\w-]*|--form[\w-]*|--upload-file|--json)(\s|=|$)/.test(part)) return 'curl sending data is an HTTP write'
    }
    if (/\b(Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b/i.test(part)) {
      // PowerShell takes "-Method Post" and "-Method:Post" alike
      const m = part.match(/-Method[\s:]+['"]?(\w+)/i)?.[1]?.toUpperCase()
      if ((m && !['GET', 'HEAD', 'OPTIONS'].includes(m)) || /\s-(Body|InFile|Form)[\s:]/i.test(part)) return 'an HTTP request with a body or a write method'
    }
  }
  return null
}

// Python's sitecustomize for watcher threads (on their PYTHONPATH, active with HIVE_READONLY=1): every HTTP request
// through the standard library (requests, urllib3, simple_salesforce, the Jira and Gong clients all use it) must be
// GET / HEAD / OPTIONS, except POSTs to known read-only search endpoints and to alert channels the user allowed.
// Not covered: clients that do not go through http.client (httpx, aiohttp, pycurl) and a Python started with -S or -I,
// which skips sitecustomize.
export const PYTHON_GUARD = String.raw`# Hive read-only guard for watcher threads (written by Hive; edits are overwritten)
import os, sys
if os.environ.get("HIVE_READONLY") == "1":
    import hashlib, re, http.client
    # (host, whole path) of the POSTs that only read
    _READ_POSTS = [
        (r"[\w-]+\.atlassian\.net", r"/rest/api/\d+/search(/jql)?"),  # Jira search
        (r"([\w-]+\.)?api\.gong\.io", r"/v2/(calls/(extensive|transcript)|users/extensive)"),  # Gong call details
        (r"api\.(\w+\.)?datadoghq\.(com|eu)", r"/api/v\d/((logs|rum|spans)/(events/|analytics/)?(search|aggregate)|logs-queries/list)"),  # Datadog search and counts
        # Salesforce sign-in, needed before any read: SOAP login only on the login hosts (on an org's own host SOAP can
        # also write), the OAuth token endpoint (it only issues a token) anywhere
        (r"(login|test)\.salesforce\.com", r"/services/Soap/u/[\d.]+"),
        (r"(login|test|[\w-]+\.my)\.salesforce\.com", r"/services/oauth2/token"),
    ]
    _POSTS = {x.strip().lower() for x in os.environ.get("HIVE_READONLY_POST_SHA256", "").split(",") if x.strip()}

    class ReadOnlyBlocked(PermissionError):
        pass

    def _allowed(method, host, path):
        m = (method or "GET").upper()
        if m in ("GET", "HEAD", "OPTIONS"):
            return True
        if m == "POST" and ".." not in path and any(re.fullmatch(h, host or "") and re.fullmatch(p, path) for h, p in _READ_POSTS):
            return True
        # an alert channel the user allowed (Settings: HIVE_WATCHER_POST_SHA256, fingerprints of host + path)
        return m == "POST" and hashlib.sha256(f"{host}{path}".encode()).hexdigest() in _POSTS

    _putrequest = http.client.HTTPConnection.putrequest

    def putrequest(self, method, url, *a, **k):
        # the bare path: no scheme and host, query or fragment, no doubled slashes
        path = re.sub(r"/+", "/", re.sub(r"^https?://[^/]+", "", url or "/").split("?")[0].split("#")[0])
        if not _allowed(method, self.host, path):
            raise ReadOnlyBlocked(f"Hive read-only: {method} https://{self.host}{path} is blocked in watcher threads")
        return _putrequest(self, method, url, *a, **k)

    http.client.HTTPConnection.putrequest = putrequest
`
