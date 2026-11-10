// Ways of writing that used to slip past the read-only shell check of watcher threads.
import { describe, expect, it } from 'vitest'
import { blockedCommand } from '../../src/shared/readOnlyCore'

const blocked = (cmd: string) => expect(blockedCommand(cmd), cmd).not.toBeNull()
const allowed = (cmd: string) => expect(blockedCommand(cmd), cmd).toBeNull()

describe('gh', () => {
  it('finds the verb behind flags', () => {
    blocked('gh pr -R owner/repo merge 5')
    blocked('gh pr --repo owner/repo close 5')
    blocked('gh pr --repo=owner/repo comment 5 --body hi')
    blocked('gh issue -R owner/repo create --title x')
    allowed('gh pr -R owner/repo list')
    allowed('gh pr -R owner/repo view 5 --json title')
    allowed('gh pr list --search merge') // a flag's value is not the verb
  })
  it('knows more writes', () => {
    blocked('gh pr update-branch 5')
    blocked('gh pr revert 5')
    blocked('gh project item-add 1 --owner o --url u')
    blocked('gh project delete 1')
    blocked('gh cache delete --all')
    blocked('gh secret remove NAME')
    blocked('gh ssh-key add key.pub')
    allowed('gh project list')
    allowed('gh project item-list 1')
    allowed('gh cache list')
    allowed('gh pr checks 5')
    allowed('gh pr diff 5')
  })
  it('still reads gh api methods and bodies', () => {
    blocked('gh api -X POST repos/o/r/issues')
    blocked('gh api repos/o/r/issues -f title=x')
    allowed('gh api repos/o/r/pulls')
    allowed('gh api -X GET repos/o/r/pulls')
  })
})

describe('git push', () => {
  it('is found behind git options', () => {
    blocked('git push')
    blocked('git -C . push')
    blocked('git -C ../other-repo push origin main')
    blocked('git -C "C:/My Repos/api" push')
    blocked('git -c user.name=x push')
    blocked('git -c http.extraHeader="A: b" push origin HEAD')
    blocked('git --no-pager push')
    blocked('git --git-dir=.git --work-tree=. push')
    blocked('git --git-dir .git push')
    blocked('cd repo && git -C . push')
    blocked('"C:\\Program Files\\Git\\bin\\git.exe" -C . push')
  })
  it('leaves reads alone, also ones that mention push', () => {
    allowed('git -C . status')
    allowed('git -C . log --oneline -5')
    allowed('git log --grep push')
    allowed('git -c core.pager=cat log --grep=push')
    allowed('git show HEAD:docs/push.md')
    allowed('git config --get push.default')
    allowed('git branch --list push-fix')
  })
})

describe('curl', () => {
  it('sees a data flag with its value attached', () => {
    blocked(`curl -d'{"a":1}' https://api.example.com/x`)
    blocked('curl -d@body.json https://api.example.com/x')
    blocked('curl -sSd x=1 https://api.example.com/x')
    blocked('curl -Ffile=@a.txt https://api.example.com/x')
    blocked('curl -T./a.txt https://api.example.com/x')
    blocked('curl --data-raw=x https://api.example.com/x')
    blocked('curl -XPOST https://api.example.com/x')
  })
  it('lets plain reads through', () => {
    allowed('curl -fsSL https://example.com/a.json')
    allowed('curl -s -H "Accept: application/json" https://example.com/a')
    allowed('curl -sS -o out.json -w "%{http_code}" https://example.com/a')
    allowed('curl -I https://example.com')
    allowed('curl -X GET https://example.com/a')
    allowed('curl -L -u user https://example.com/a')
  })
})

describe('PowerShell web requests', () => {
  it('reads -Method and -Body with a colon too', () => {
    blocked('Invoke-RestMethod -Uri https://x -Method:Post')
    blocked("Invoke-RestMethod -Uri https://x -Method:'Delete'")
    blocked('Invoke-RestMethod -Uri https://x -Method Put')
    blocked('irm https://x -Body:$json')
    blocked('Invoke-WebRequest https://x -InFile a.json -Method Get')
    blocked('iwr https://x -Form @{a=1}')
  })
  it('lets reads through', () => {
    allowed('Invoke-RestMethod -Uri https://x')
    allowed('Invoke-RestMethod -Uri https://x -Method:Get')
    allowed('iwr https://x -Method Head -OutFile a.html')
  })
})
