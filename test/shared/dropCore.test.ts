import { test } from 'vitest'
import assert from 'node:assert/strict'
import * as d from '../../src/shared/dropCore'

test('pickDropFile takes the first absolute csv/xlsx/xls/pdf/json, any case', () => {
  assert.equal(d.pickDropFile(['C:\\a\\pic.png', 'C:\\a\\list.XLSX', 'C:\\a\\b.csv']), 'C:\\a\\list.XLSX')
  for (const ext of ['csv', 'xlsx', 'xls', 'pdf', 'json']) assert.equal(d.pickDropFile([`C:\\f\\x.${ext}`]), `C:\\f\\x.${ext}`)
  assert.equal(d.pickDropFile(['/home/u/x.json']), '/home/u/x.json')
  assert.equal(d.pickDropFile(['C:\\a\\x.docx', 'C:\\a\\noext']), null)
  assert.equal(d.pickDropFile(['x.csv']), null) // not absolute
  assert.equal(d.pickDropFile([]), null)
})
test('dropMessage and dropTitle name the skill and the file', () => {
  const choice: d.DropChoice = { id: 'intake', skill: 'csv-import', label: 'Import (csv-import skill)', title: 'Import' }
  assert.equal(d.dropMessage(choice, 'C:\\d\\Sample Data.xlsx'), 'Use the csv-import skill on the file at C:\\d\\Sample Data.xlsx')
  assert.equal(d.dropMessage(choice, '/x/l.csv'), 'Use the csv-import skill on the file at /x/l.csv')
  assert.equal(d.dropTitle(choice, 'C:\\d\\list.xlsx'), 'Import: list.xlsx')
  assert.equal(d.dropTitle(choice, '/home/u/list.csv'), 'Import: list.csv')
})
