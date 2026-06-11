'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFinance } = require('./harness');

const F = loadFinance();

// Values returned from the vm sandbox carry that realm's prototypes, so
// assert.deepStrictEqual fails on prototype identity. Round-trip through JSON to
// get host-realm plain objects before deep comparison.
const plain = (v) => JSON.parse(JSON.stringify(v));
// calcSGTax returns un-rounded floats; compare with tolerance.
const closeTo = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !≈ ${b}`);

// ─────────────────────────────────────────────────────────────────────────────
// calcSGTax — IRAS resident rates, YA2024+
// ─────────────────────────────────────────────────────────────────────────────
test('calcSGTax: zero/negative income is untaxed', () => {
  assert.equal(F.calcSGTax(0), 0);
  assert.equal(F.calcSGTax(-5000), 0);
});

test('calcSGTax: first $20k band is 0%', () => {
  assert.equal(F.calcSGTax(20000), 0);
});

test('calcSGTax: marginal bands accumulate correctly', () => {
  // 20k@0 + 10k@2% = 200
  closeTo(F.calcSGTax(30000), 200);
  // + 10k@3.5% = 350  → 550
  closeTo(F.calcSGTax(40000), 550);
  // + 40k@7% = 2800   → 3350
  closeTo(F.calcSGTax(80000), 3350);
});

test('calcSGTax: matches published IRAS cumulative figures', () => {
  // These are the totals IRAS publishes for each band ceiling.
  closeTo(F.calcSGTax(320000), 44550);
  closeTo(F.calcSGTax(500000), 84150);
  closeTo(F.calcSGTax(1000000), 199150);
});

test('calcSGTax: top marginal rate (24%) applies above $1M', () => {
  closeTo(F.calcSGTax(1100000), 199150 + 100000 * 0.24);
});

test('calcSGTax: monotonically non-decreasing', () => {
  let prev = -1;
  for (let inc = 0; inc <= 1500000; inc += 12345) {
    const t = F.calcSGTax(inc);
    assert.ok(t >= prev, `tax should not decrease at income ${inc}`);
    prev = t;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// getOngoingDueInfo — recurring expense date math
// ─────────────────────────────────────────────────────────────────────────────
test('getOngoingDueInfo: no startDate → null', () => {
  assert.equal(F.getOngoingDueInfo({ frequency: 'monthly' }, new Date(2024, 5, 15)), null);
});

test('getOngoingDueInfo: unknown frequency → null', () => {
  assert.equal(
    F.getOngoingDueInfo({ frequency: 'weekly', startDate: '2024-01-01' }, new Date(2024, 5, 15)),
    null
  );
});

test('getOngoingDueInfo: monthly due in current month', () => {
  const r = F.getOngoingDueInfo({ frequency: 'monthly', startDate: '2024-01-10' }, new Date(2024, 2, 15));
  assert.deepEqual(plain(r), { dueDate: '2024-03-10', periodKey: '2024-03' });
});

test('getOngoingDueInfo: monthly before the due day in-month → null', () => {
  // Start day is the 20th; on the 15th it is not yet due.
  const r = F.getOngoingDueInfo({ frequency: 'monthly', startDate: '2024-01-20' }, new Date(2024, 2, 15));
  assert.equal(r, null);
});

test('getOngoingDueInfo: monthly before start date → null', () => {
  const r = F.getOngoingDueInfo({ frequency: 'monthly', startDate: '2024-05-10' }, new Date(2024, 2, 15));
  assert.equal(r, null);
});

test('getOngoingDueInfo: monthly clamps day to last day of short month', () => {
  // Start on the 31st; February 2024 (leap) has 29 days → due 2024-02-29.
  const r = F.getOngoingDueInfo({ frequency: 'monthly', startDate: '2024-01-31' }, new Date(2024, 1, 29));
  assert.deepEqual(plain(r), { dueDate: '2024-02-29', periodKey: '2024-02' });
});

test('getOngoingDueInfo: quarterly only on 3-month multiples from start', () => {
  const o = { frequency: 'quarterly', startDate: '2024-01-15' };
  // April = 3 months after January → due.
  assert.deepEqual(plain(F.getOngoingDueInfo(o, new Date(2024, 3, 20))),
    { dueDate: '2024-04-15', periodKey: '2024-04' });
  // May = 4 months after → not a quarter boundary.
  assert.equal(F.getOngoingDueInfo(o, new Date(2024, 4, 20)), null);
});

test('getOngoingDueInfo: annual only in start month, period keyed by year', () => {
  const o = { frequency: 'annual', startDate: '2024-03-20' };
  assert.deepEqual(plain(F.getOngoingDueInfo(o, new Date(2025, 2, 25))),
    { dueDate: '2025-03-20', periodKey: '2025' });
  // Wrong month → null.
  assert.equal(F.getOngoingDueInfo(o, new Date(2025, 3, 25)), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// mergeData — bidirectional Drive sync, conflict resolution
// ─────────────────────────────────────────────────────────────────────────────
function baseSide(over = {}) {
  return Object.assign({ expenses: [], accounts: [], assets: [] }, over);
}

test('mergeData: expenses union by id, higher _ts wins', () => {
  const local = baseSide({ expenses: [{ id: 'a', ac: 'x', amount: 5, _ts: 1 }] });
  const remote = baseSide({ expenses: [
    { id: 'a', ac: 'x', amount: 9, _ts: 2 },
    { id: 'b', ac: 'x', amount: 3, _ts: 1 },
  ] });
  const m = F.mergeData(local, remote);
  const byId = Object.fromEntries(m.expenses.map(e => [e.id, e]));
  assert.equal(byId.a.amount, 9, 'newer _ts wins');
  assert.equal(byId.b.amount, 3, 'remote-only record kept');
  assert.equal(m.expenses.length, 2);
});

test('mergeData: tombstoned ids are excluded from the merge', () => {
  const local = baseSide({ expenses: [{ id: 'a', ac: 'x', amount: 5, _ts: 1 }], _deletedIds: ['a'] });
  const remote = baseSide({ expenses: [{ id: 'a', ac: 'x', amount: 9, _ts: 99 }] });
  const m = F.mergeData(local, remote);
  assert.equal(m.expenses.find(e => e.id === 'a'), undefined);
  assert.ok(m._deletedIds.includes('a'));
});

test('mergeData: accounts prefer higher _updatedAt', () => {
  const local = baseSide({ accounts: [{ id: 'acc1', name: 'Old', startingBalance: 100, _updatedAt: 1 }] });
  const remote = baseSide({ accounts: [{ id: 'acc1', name: 'New', startingBalance: 200, _updatedAt: 2 }] });
  const m = F.mergeData(local, remote);
  assert.equal(m.accounts[0].name, 'New');
  assert.equal(m.accounts[0].startingBalance, 200);
});

test('mergeData: budgets shallow-merge with local keys winning', () => {
  const local = baseSide({ budgets: { Grocery: 500, Travel: 200 } });
  const remote = baseSide({ budgets: { Grocery: 999, Bills: 100 } });
  const m = F.mergeData(local, remote);
  assert.equal(m.budgets.Grocery, 500, 'local key wins');
  assert.equal(m.budgets.Travel, 200);
  assert.equal(m.budgets.Bills, 100, 'remote-only key kept');
});

test('mergeData: asset histories are merged and de-duplicated by _ts', () => {
  const local = baseSide({ assets: [{ id: 'as1', name: 'Stocks', class: 'Equities', units: 1, _nameTs: 2,
    history: [{ date: '2024-01-01', value: 100, _ts: 1 }] }] });
  const remote = baseSide({ assets: [{ id: 'as1', name: 'OldName', class: 'Equities', units: 1, _nameTs: 1,
    history: [{ date: '2024-01-01', value: 100, _ts: 1 }, { date: '2024-02-01', value: 150, _ts: 2 }] }] });
  const m = F.mergeData(local, remote);
  const asset = m.assets.find(a => a.id === 'as1');
  assert.equal(asset.name, 'Stocks', 'local name wins via higher _nameTs');
  assert.equal(asset.history.length, 2, 'duplicate _ts collapsed, new point added');
  assert.deepEqual(plain(asset.history.map(h => h._ts).sort()), [1, 2]);
});

test('mergeData: netWorthSnapshots union by key, higher _ts wins', () => {
  const local = baseSide({ netWorthSnapshots: [{ key: '2024-01-01', net: 100, _ts: 1 }] });
  const remote = baseSide({ netWorthSnapshots: [
    { key: '2024-01-01', net: 999, _ts: 5 },
    { key: '2024-04-01', net: 200, _ts: 1 },
  ] });
  const m = F.mergeData(local, remote);
  const byKey = Object.fromEntries(m.netWorthSnapshots.map(s => [s.key, s.net]));
  assert.equal(byKey['2024-01-01'], 999);
  assert.equal(byKey['2024-04-01'], 200);
});

test('mergeData: recomputes account balances from starting balance + expenses', () => {
  const local = baseSide({
    accounts: [{ id: 'acc1', name: 'A', startingBalance: 1000, _updatedAt: 1 }],
    expenses: [{ id: 'e1', ac: 'acc1', amount: 30, cat: 'Grocery', _ts: 1 }],
  });
  const remote = baseSide({ accounts: [{ id: 'acc1', name: 'A', startingBalance: 1000, _updatedAt: 1 }] });
  const m = F.mergeData(local, remote);
  assert.equal(m.accounts[0].balance, 970, 'balance = starting - spend');
});

// ─────────────────────────────────────────────────────────────────────────────
// mergeHistoryData — past-year expenses + power records
// ─────────────────────────────────────────────────────────────────────────────
test('mergeHistoryData: union by id across collections, higher _ts wins', () => {
  const local = { expenses: [{ id: 'h1', amount: 5, _ts: 1 }], powerRecords: [{ id: 'p1', _ts: 1 }] };
  const remote = {
    expenses: [{ id: 'h1', amount: 9, _ts: 2 }, { id: 'h2', amount: 1, _ts: 1 }],
    powerRecords: [{ id: 'p1', elecUsage: 50, _ts: 2 }],
  };
  const m = F.mergeHistoryData(local, remote);
  assert.equal(m.expenses.find(e => e.id === 'h1').amount, 9);
  assert.ok(m.expenses.find(e => e.id === 'h2'));
  assert.equal(m.powerRecords.find(p => p.id === 'p1').elecUsage, 50);
});

// ─────────────────────────────────────────────────────────────────────────────
// mergeWikiData — recipes / shoppingLists / resumes (separate wiki file)
// ─────────────────────────────────────────────────────────────────────────────
test('mergeWikiData: union by id across collections, higher _updatedAt wins', () => {
  const local = {
    recipes: [{ id: 'r1', title: 'Old', _updatedAt: 1 }],
    shoppingLists: [{ id: 's1', title: 'List', _updatedAt: 2 }],
    resumes: [],
  };
  const remote = {
    recipes: [{ id: 'r1', title: 'New', _updatedAt: 5 }, { id: 'r2', title: 'Extra', _updatedAt: 1 }],
    shoppingLists: [{ id: 's1', title: 'Stale', _updatedAt: 1 }],
    resumes: [{ id: 'cv1', name: 'Me', _updatedAt: 1 }],
  };
  const m = F.mergeWikiData(local, remote);
  assert.equal(m.recipes.find(r => r.id === 'r1').title, 'New');   // remote newer wins
  assert.ok(m.recipes.find(r => r.id === 'r2'));                   // remote-only kept
  assert.equal(m.shoppingLists.find(l => l.id === 's1').title, 'List'); // local newer wins
  assert.ok(m.resumes.find(r => r.id === 'cv1'));                  // remote-only kept
});

test('mergeWikiData: tolerates missing collections', () => {
  const m = F.mergeWikiData({ recipes: [{ id: 'r1', _updatedAt: 1 }] }, {});
  assert.equal(m.recipes.length, 1);
  assert.deepEqual(plain(m.shoppingLists), []);
  assert.deepEqual(plain(m.resumes), []);
});

// ─────────────────────────────────────────────────────────────────────────────
// mergeData — unionById for all remaining collections
// ─────────────────────────────────────────────────────────────────────────────
test('mergeData: events/taxRecords/cpfRecords/dependents/medicalVisits union-by-id via _ts', () => {
  const local = baseSide({
    events:        [{ id: 'ev1', title: 'Old', _ts: 1 }],
    taxRecords:    [{ id: 'tx1', year: 2023, _ts: 1 }],
    cpfRecords:    [{ id: 'cf1', year: 2023, _ts: 1 }],
    dependents:    [{ id: 'dp1', name: 'Old', _ts: 1 }],
    medicalVisits: [{ id: 'mv1', title: 'Old', _ts: 1 }],
  });
  const remote = baseSide({
    events:        [{ id: 'ev1', title: 'New', _ts: 2 }, { id: 'ev2', title: 'Extra', _ts: 1 }],
    taxRecords:    [{ id: 'tx1', year: 2024, _ts: 2 }],
    cpfRecords:    [{ id: 'cf1', year: 2024, _ts: 2 }],
    dependents:    [{ id: 'dp1', name: 'New', _ts: 2 }],
    medicalVisits: [{ id: 'mv1', title: 'New', _ts: 2 }],
  });
  const m = F.mergeData(local, remote);
  assert.equal(m.events.find(e => e.id === 'ev1').title, 'New', 'newer _ts wins');
  assert.equal(m.events.length, 2, 'remote-only event kept');
  assert.equal(m.taxRecords.find(r => r.id === 'tx1').year, 2024);
  assert.equal(m.cpfRecords.find(r => r.id === 'cf1').year, 2024);
  assert.equal(m.dependents.find(d => d.id === 'dp1').name, 'New');
  assert.equal(m.medicalVisits.find(v => v.id === 'mv1').title, 'New');
});

test('mergeData: insurances/ongoingExpenses/notes union-by-id via _updatedAt', () => {
  const local = baseSide({
    insurances:      [{ id: 'in1', name: 'Old', _updatedAt: 1 }],
    ongoingExpenses: [{ id: 'og1', name: 'Old', _updatedAt: 1 }],
    notes:           [{ id: 'nt1', title: 'Old', _updatedAt: 1 }],
  });
  const remote = baseSide({
    insurances:      [{ id: 'in1', name: 'New', _updatedAt: 2 }],
    ongoingExpenses: [{ id: 'og1', name: 'New', _updatedAt: 2 }],
    notes:           [{ id: 'nt1', title: 'New', _updatedAt: 2 }],
  });
  const m = F.mergeData(local, remote);
  assert.equal(m.insurances.find(i => i.id === 'in1').name, 'New');
  assert.equal(m.ongoingExpenses.find(o => o.id === 'og1').name, 'New');
  assert.equal(m.notes.find(n => n.id === 'nt1').title, 'New');
});

test('mergeData: unionById local wins on equal timestamps', () => {
  const local  = baseSide({ events: [{ id: 'ev1', title: 'Local', _ts: 5 }] });
  const remote = baseSide({ events: [{ id: 'ev1', title: 'Remote', _ts: 5 }] });
  const m = F.mergeData(local, remote);
  assert.equal(m.events[0].title, 'Local');
});

test('mergeData: _deletedIds filters all unionById collections', () => {
  const local = baseSide({
    events:          [{ id: 'ev1', _ts: 1 }],
    insurances:      [{ id: 'in1', _updatedAt: 1 }],
    ongoingExpenses: [{ id: 'og1', _updatedAt: 1 }],
    _deletedIds: ['ev1', 'in1', 'og1'],
  });
  const remote = baseSide({
    events:          [{ id: 'ev1', _ts: 9 }],
    insurances:      [{ id: 'in1', _updatedAt: 9 }],
    ongoingExpenses: [{ id: 'og1', _updatedAt: 9 }],
  });
  const m = F.mergeData(local, remote);
  assert.equal(m.events.length, 0);
  assert.equal(m.insurances.length, 0);
  assert.equal(m.ongoingExpenses.length, 0);
  assert.ok(m._deletedIds.includes('ev1'));
});

// ─────────────────────────────────────────────────────────────────────────────
// mergeData — lww scalar fields
// ─────────────────────────────────────────────────────────────────────────────
test('mergeData: lww — local wins when timestamp is newer', () => {
  const local  = baseSide({ cpfSettings: { dateOfBirth: '1990-01-01' }, _cpfSettingsTs: 10 });
  const remote = baseSide({ cpfSettings: { dateOfBirth: '1985-01-01' }, _cpfSettingsTs: 5 });
  const m = F.mergeData(local, remote);
  assert.equal(m.cpfSettings.dateOfBirth, '1990-01-01');
  assert.equal(m._cpfSettingsTs, 10);
});

test('mergeData: lww — remote wins when timestamp is newer', () => {
  const local  = baseSide({ cpfSettings: { dateOfBirth: '1990-01-01' }, _cpfSettingsTs: 3 });
  const remote = baseSide({ cpfSettings: { dateOfBirth: '1985-01-01' }, _cpfSettingsTs: 7 });
  const m = F.mergeData(local, remote);
  assert.equal(m.cpfSettings.dateOfBirth, '1985-01-01');
  assert.equal(m._cpfSettingsTs, 7);
});

test('mergeData: lww — local wins on equal timestamps', () => {
  const local  = baseSide({ expenseCats: 'Local',  _expenseCatsTs: 5 });
  const remote = baseSide({ expenseCats: 'Remote', _expenseCatsTs: 5 });
  const m = F.mergeData(local, remote);
  assert.equal(m.expenseCats, 'Local');
});

test('mergeData: lww — explicit empty string from winning side is preserved', () => {
  // Uses ?? internally; || would incorrectly fall through to the remote value.
  const local  = baseSide({ expenseCats: '', _expenseCatsTs: 5 });
  const remote = baseSide({ expenseCats: 'Grocery,Travel', _expenseCatsTs: 3 });
  const m = F.mergeData(local, remote);
  assert.equal(m.expenseCats, '');
});

test('mergeData: lww — explicit null from winning side is preserved (M4)', () => {
  // User cleared customAiPrompt on local (newer ts); merge must keep null and not
  // resurrect the partner's old value.
  const local  = baseSide({ customAiPrompt: null, _customAiPromptTs: 10 });
  const remote = baseSide({ customAiPrompt: 'My old prompt', _customAiPromptTs: 5 });
  const m = F.mergeData(local, remote);
  assert.equal(m.customAiPrompt, null, 'null from newer winner must not be overwritten by loser');
});

test('mergeData: asset _deletedHistoryTs tombstones applied during merge (H8)', () => {
  const badEntry = { date: '2024-03-01', value: 500000, _ts: 99 };
  // Local deleted the bad entry; remote still has it.
  const local = baseSide({ assets: [{
    id: 'as1', name: 'S', class: 'Equities', units: 1,
    history: [{ date: '2024-01-01', value: 100, _ts: 1 }],
    _deletedHistoryTs: [99],
  }] });
  const remote = baseSide({ assets: [{
    id: 'as1', name: 'S', class: 'Equities', units: 1,
    history: [{ date: '2024-01-01', value: 100, _ts: 1 }, badEntry],
  }] });
  const m = F.mergeData(local, remote);
  const asset = m.assets.find(a => a.id === 'as1');
  assert.equal(asset.history.length, 1, 'deleted entry must not resurface after merge');
  assert.ok(asset._deletedHistoryTs.includes(99), 'tombstone carried into merged asset');
});

test('mergeData: lww — emailCatMap and emailCatDefault share _emailCatMapTs', () => {
  const local  = baseSide({ emailCatMap: [{ match: 'a', value: 'Grocery' }], emailCatDefault: 'Travel',  _emailCatMapTs: 1 });
  const remote = baseSide({ emailCatMap: [],                                  emailCatDefault: 'Other',   _emailCatMapTs: 5 });
  const m = F.mergeData(local, remote);
  assert.deepEqual(plain(m.emailCatMap), []);
  assert.equal(m.emailCatDefault, 'Other');
  assert.equal(m._emailCatMapTs, 5);
});

test('mergeData: lww — busProxyUrl and busProxyToken share _busProxyTs', () => {
  const local  = baseSide({ busProxyUrl: 'http://local',  busProxyToken: 'tok-l', _busProxyTs: 10 });
  const remote = baseSide({ busProxyUrl: 'http://remote', busProxyToken: 'tok-r', _busProxyTs: 5 });
  const m = F.mergeData(local, remote);
  assert.equal(m.busProxyUrl, 'http://local');
  assert.equal(m.busProxyToken, 'tok-l');
  assert.equal(m._busProxyTs, 10);
});

test('mergeData: lww — retirementSettings merges winner with RS_DEFAULTS', () => {
  const local = baseSide({ retirementSettings: { retirementAge: 60 }, _retirementSettingsTs: 5 });
  const remote = baseSide();
  const m = F.mergeData(local, remote);
  assert.equal(m.retirementSettings.retirementAge, 60, 'local value preserved');
  assert.equal(m.retirementSettings.inflationRate, 2.5, 'default filled in for missing key');
});

test('mergeData: lww — all timestamp fields carried into merged object', () => {
  const ts = { _cpfSettingsTs: 1, _termDatesTs: 2, _eventTagsTs: 3, _expenseCatsTs: 4,
               _emailParsersTs: 5, _emailCatMapTs: 6, _aiReportTs: 7, _allocationRatiosTs: 8,
               _customAiPromptTs: 9, _retirementSettingsTs: 10, _busProxyTs: 11, _dependentsTs: 12 };
  const m = F.mergeData(baseSide(ts), baseSide());
  for (const [k, v] of Object.entries(ts)) {
    assert.equal(m[k], v, `${k} should be ${v}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// mergeData — mortgage entry merging
// ─────────────────────────────────────────────────────────────────────────────
test('mergeData: mortgages merge entries from both sides, deduplicating by id', () => {
  const local = baseSide({ mortgages: [{ id: 'm1', name: 'Home', _updatedAt: 2,
    entries: [{ id: 'e1', type: 'payment', amount: 100, _ts: 1 }] }] });
  const remote = baseSide({ mortgages: [{ id: 'm1', name: 'Home', _updatedAt: 1,
    entries: [{ id: 'e1', type: 'payment', amount: 100, _ts: 1 },
              { id: 'e2', type: 'interest', amount: 50, _ts: 2 }] }] });
  const m = F.mergeData(local, remote);
  const mort = m.mortgages.find(x => x.id === 'm1');
  assert.equal(mort.entries.length, 2, 'duplicate entry collapsed, unique entry from remote kept');
  assert.ok(mort.entries.find(e => e.id === 'e2'));
});

test('mergeData: mortgage top-level fields prefer higher _updatedAt', () => {
  const local  = baseSide({ mortgages: [{ id: 'm1', name: 'Local Name',  _updatedAt: 5, entries: [] }] });
  const remote = baseSide({ mortgages: [{ id: 'm1', name: 'Remote Name', _updatedAt: 3, entries: [] }] });
  const m = F.mergeData(local, remote);
  assert.equal(m.mortgages[0].name, 'Local Name');
});

test('mergeData: mortgage deleted entry is excluded', () => {
  const local = baseSide({
    mortgages:   [{ id: 'm1', _updatedAt: 1, entries: [{ id: 'e1', _ts: 1 }, { id: 'e2', _ts: 2 }] }],
    _deletedIds: ['e1'],
  });
  const m = F.mergeData(local, baseSide());
  const mort = m.mortgages[0];
  assert.equal(mort.entries.find(e => e.id === 'e1'), undefined, 'tombstoned entry removed');
  assert.ok(mort.entries.find(e => e.id === 'e2'));
});

// ─────────────────────────────────────────────────────────────────────────────
// mergeData — file ID propagation
// ─────────────────────────────────────────────────────────────────────────────
test('mergeData: wikiFileId and historyFileId prefer non-empty from either side', () => {
  const local  = baseSide({ wikiFileId: null,       historyFileId: 'hist-123' });
  const remote = baseSide({ wikiFileId: 'wiki-456', historyFileId: null });
  const m = F.mergeData(local, remote);
  assert.equal(m.wikiFileId, 'wiki-456');
  assert.equal(m.historyFileId, 'hist-123');
});

test('mergeData: wikiUpdatedAt always taken from local', () => {
  const local  = baseSide({ wikiUpdatedAt: 999 });
  const remote = baseSide({ wikiUpdatedAt: 1 });
  const m = F.mergeData(local, remote);
  assert.equal(m.wikiUpdatedAt, 999);
});

// ─────────────────────────────────────────────────────────────────────────────
// calcRetirementPlan — depends on global `data`
// ─────────────────────────────────────────────────────────────────────────────
function retirementData() {
  const d = F.defaultData();
  d.cpfSettings = { dateOfBirth: '1985-06-15', retirementAge: 65 };
  d.retirementSettings = {
    inflationRate: 2.5, investmentRate: 5.0, retirementAge: 62, deathAge: 85,
    monthlyExpenses: 3000, annualSavings: 120000, safeWithdrawalRate: 4.0,
  };
  return d;
}

test('calcRetirementPlan: currentAssets sums only investable non-CPF/SRS assets', () => {
  const d = retirementData();
  d.assets = [
    { id: 'a1', name: 'Stocks', class: 'Equities', units: 1, history: [{ date: '2024-01-01', value: 100000, _ts: 1 }] },
    { id: 'a2', name: 'Home', class: 'Home (own use)', units: 1, history: [{ date: '2024-01-01', value: 800000, _ts: 1 }] },
    { id: 'a3', name: 'CPF lump', class: 'CPF', units: 1, history: [{ date: '2024-01-01', value: 50000, _ts: 1 }] },
  ];
  F.setData(d);
  const plan = F.calcRetirementPlan();
  assert.equal(plan.currentAssets, 100000, 'own-home and CPF excluded from investable assets');
});

test('calcRetirementPlan: produces a yearly drawdown projection', () => {
  const d = retirementData();
  d.assets = [];
  F.setData(d);
  const plan = F.calcRetirementPlan();
  assert.ok(Array.isArray(plan.rows) && plan.rows.length > 0);
  assert.equal(plan.annualSavings, 120000);
  assert.equal(typeof plan.currentAge, 'number');
});
