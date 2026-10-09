'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../assets/core.js');
const { validDate, parseTime, occursOn, validateEntry, validateAIResponse } = core;
const expense = (extra = {}) => ({ date: '2026-10-08', amount: 12.5, ...extra });
const ai = (extra = {}) => ({ detected_type: 'todo_task', confidence: 0.9, needs_more: false, questions: [], reply: 'Ready to add.', data: { title: 'Call the vet' }, ...extra });

test('UMD exports the same API to browsers and CommonJS', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/core.js'), 'utf8'), context);
  for (const name of ['validDate', 'parseTime', 'occursOn', 'validateEntry', 'validateAIResponse']) {
    assert.equal(typeof core[name], 'function');
    assert.equal(typeof context.window.AnchorCore[name], 'function');
  }
  assert.equal(context.window.AnchorCore.validDate('2024-02-29'), true);
  assert.equal(Object.isFrozen(core), true);
});

test('validDate accepts real dates with Gregorian century and leap rules', () => {
  for (const date of ['0001-01-01', '0099-12-31', '2000-02-29', '2024-02-29', '2026-10-08', '9999-12-31']) assert.equal(validDate(date), true, date);
});

test('validDate rejects overflow, ambiguous formats, non-strings, and year zero', () => {
  for (const date of ['2025-02-29', '1900-02-29', '2100-02-29', '2024-04-31', '2024-00-01', '2024-13-01', '2024-01-00', '2024-01-32', '0000-01-01', '2024-1-01', '2024-01-1', '2024-01-01T00:00:00Z', ' 2024-01-01', 'today', '', 20240101, null, undefined, {}, []]) assert.equal(validDate(date), false, String(date));
});

test('parseTime correctly normalizes midnight, noon, 12-hour and 24-hour values', () => {
  for (const [value, expected] of [['12am', 0], ['12:00 AM', 0], ['12pm', 12], ['12:30 pm', 12.5], ['1pm', 13], ['9', 9], [' 9:30 AM ', 9.5], ['00:00', 0], ['09:30', 9.5], ['21:30', 21.5], ['23:59', 23 + 59 / 60], ['930', 9.5], ['0930', 9.5], ['2130', 21.5], ['930pm', 21.5]]) assert.equal(parseTime(value), expected, value);
});

test('parseTime rejects invalid hours/minutes and malformed input instead of rolling over', () => {
  for (const value of ['24:00', '99:00', '12:60', '23:99', '0am', '00pm', '13pm', '13:30am', '24', '-1:30', '9:3', '9:300', '9.5', '9:30pm extra', '9999', '2360', '09:30:99', 'am', '', ' ', null, undefined, 930, {}, ['9:30']]) assert.equal(parseTime(value), null, String(value));
});

test('one-off and legacy Custom reminders occur only on the original date', () => {
  for (const repeat_rule of ['None', 'Custom', undefined, 'not supported']) {
    assert.equal(occursOn({ date: '2026-10-08', repeat_rule }, '2026-10-08'), true);
    assert.equal(occursOn({ date: '2026-10-08', repeat_rule }, '2026-10-09'), false);
    assert.equal(occursOn({ date: '2026-10-08', repeat_rule }, '2026-10-07'), false);
  }
});

test('daily recurrence honors inclusive start/end and leap days', () => {
  const reminder = { date: '2024-02-28', repeat_rule: 'Daily', end_date: '2024-03-01' };
  for (const date of ['2024-02-28', '2024-02-29', '2024-03-01']) assert.equal(occursOn(reminder, date), true, date);
  for (const date of ['2024-02-27', '2024-03-02', '2024-02-30']) assert.equal(occursOn(reminder, date), false, date);
});

test('weekly recurrence matches calendar weeks across DST and year boundaries', () => {
  const reminder = { date: '2024-03-03', repeat_rule: 'Weekly' };
  assert.equal(occursOn(reminder, '2024-03-10'), true);
  assert.equal(occursOn(reminder, '2024-03-17'), true);
  assert.equal(occursOn(reminder, '2024-03-11'), false);
  assert.equal(occursOn(reminder, '2024-02-25'), false);
  assert.equal(occursOn({ date: '2025-12-31', repeat_rule: 'Weekly' }, '2026-01-07'), true);
});

test('monthly recurrence skips missing month-end dates and preserves leap-day anchors', () => {
  const endOfMonth = { date: '2024-01-31', repeat_rule: 'Monthly' };
  assert.equal(occursOn(endOfMonth, '2024-02-29'), false);
  assert.equal(occursOn(endOfMonth, '2024-03-31'), true);
  assert.equal(occursOn(endOfMonth, '2024-04-30'), false);
  assert.equal(occursOn(endOfMonth, '2025-01-31'), true);
  const leap = { date: '2024-02-29', repeat_rule: 'Monthly' };
  assert.equal(occursOn(leap, '2024-03-29'), true);
  assert.equal(occursOn(leap, '2025-02-28'), false);
  assert.equal(occursOn(leap, '2028-02-29'), true);
});

test('recurrence supports start_date records and safely rejects invalid ranges', () => {
  assert.equal(occursOn({ start_date: '2026-10-08', repeat_rule: 'Daily' }, '2026-10-09'), true);
  assert.equal(occursOn({ date: '2026-10-01', start_date: '2026-10-08', repeat_rule: 'Daily' }, '2026-10-07'), false);
  for (const reminder of [null, {}, { date: '2026-02-30' }, { date: '2026-10-08', end_date: 'bad' }, { date: '2026-10-08', end_date: '2026-10-01' }, { date: '2026-10-08', start_date: 'bad' }]) assert.equal(occursOn(reminder, '2026-10-08'), false);
});

test('every supported entry type accepts its minimum valid shape', () => {
  const entries = {
    work_shift: { date: '2026-10-08', hours_worked: 0 },
    expense: expense(), income: expense(),
    todo_task: { title: 'Call' }, todo_list: { title: 'Tasks', items: [] }, shopping_list: { title: 'Shopping', items: ['Milk'] },
    habit: { name: 'Read' }, workout_routine: { name: 'Stretch' },
    calendar_event: { title: 'Lunch', date: '2026-10-08' }, reminder: { title: 'Water plants', date: '2026-10-08' }, note: { title: 'Ideas', notes: 'A thought' }
  };
  assert.deepEqual(Object.keys(entries), [...core.TYPES]);
  for (const [type, data] of Object.entries(entries)) assert.deepEqual(validateEntry(type, data), data, type);
});

test('validation trims text and converts decimal numeric strings without mutating input', () => {
  const input = { title: '  Groceries  ', items: ['  Milk ', 'Eggs'], notes: '  Remember bags  ', metadata: { source: 'manual' } };
  const result = validateEntry('shopping_list', input);
  assert.equal(result.title, 'Groceries');
  assert.deepEqual(result.items, ['Milk', 'Eggs']);
  assert.equal(result.notes, 'Remember bags');
  result.items.push('Bread');
  result.metadata.source = 'edited';
  assert.equal(input.items.length, 2);
  assert.equal(input.metadata.source, 'manual');
  assert.equal(validateEntry('expense', expense({ amount: ' 12.50 ' })).amount, 12.5);
  assert.equal(validateEntry('expense', expense({ amount: 0 })).amount, 0);
});

test('empty and non-text required titles/names cannot silently become defaults', () => {
  for (const type of ['todo_task', 'todo_list', 'shopping_list', 'calendar_event', 'reminder', 'note']) {
    for (const title of [undefined, null, '', '  ', 42, {}]) {
      const data = { date: '2026-10-08' };
      if (title !== undefined) data.title = title;
      assert.throws(() => validateEntry(type, data), /Title|plain JSON/, type);
    }
  }
  for (const type of ['habit', 'workout_routine']) assert.throws(() => validateEntry(type, { name: '  ' }), /Name is required/);
  assert.throws(() => validateEntry('todo_task', { title: 'x'.repeat(201) }), /200/);
});

test('finance and hour values must be nonnegative finite numbers', () => {
  for (const amount of [-1, '-0.01', NaN, Infinity, -Infinity, 'Infinity', 'NaN', '1e999', true, {}, [], '0x10', '$5', 'five']) assert.throws(() => validateEntry('expense', expense({ amount })), /number|Number|plain JSON|finite/i, String(amount));
  for (const amount of [undefined, null, '', ' ']) {
    const data = { date: '2026-10-08' };
    if (amount !== undefined) data.amount = amount;
    assert.throws(() => validateEntry('income', data), /Amount is required/);
  }
  for (const key of ['hours_worked', 'hourly_rate', 'cash_tips', 'digital_tips', 'wage_pay', 'total_shift_income']) {
    assert.throws(() => validateEntry('work_shift', { date: '2026-10-08', [key]: -1 }), /nonnegative/);
    assert.throws(() => validateEntry('work_shift', { date: '2026-10-08', [key]: Infinity }), /finite/);
  }
  assert.throws(() => validateEntry('habit', { name: 'Walk', target_amount: -1 }), /nonnegative/);
});

test('entry dates, ranges, and all supplied time fields are strictly validated', () => {
  for (const type of ['work_shift', 'expense', 'income', 'calendar_event', 'reminder']) assert.throws(() => validateEntry(type, { title: 'Test', amount: 1 }), /Date is required/);
  for (const key of ['date', 'due_date', 'start_date', 'end_date']) assert.throws(() => validateEntry('todo_task', { title: 'Test', [key]: '2026-02-30' }), /real date/);
  for (const key of ['time', 'start_time', 'end_time', 'reminder_time']) assert.throws(() => validateEntry('todo_task', { title: 'Test', [key]: '25:01' }), /valid time/);
  assert.throws(() => validateEntry('reminder', { title: 'Test', date: '2026-10-08', end_date: '2026-10-07' }), /End date/);
  assert.deepEqual(validateEntry('todo_task', { title: 'Test', due_date: '', time: '' }), { title: 'Test', due_date: null, time: null });
});

test('lists accept bounded text only, never coerce objects, and permit an intentionally empty list', () => {
  for (const items of ['milk', null, [12], [{}], [['milk']], [''], ['  '], ['a'.repeat(501)], Array(101).fill('milk')]) assert.throws(() => validateEntry('shopping_list', { title: 'Shopping', items }), /List|list|items|text|500/);
  assert.deepEqual(validateEntry('todo_list', { title: 'Tasks' }).items, []);
  assert.equal(validateEntry('todo_list', { title: 'Tasks', items: Array(100).fill('Task') }).items.length, 100);
  assert.throws(() => validateEntry('todo_list', { title: 'Tasks', items: [, 'Task'] }), /empty slots/);
});

test('recurrence and constrained enum values reject unsupported rules', () => {
  for (const repeat_rule of core.REPEAT_RULES) assert.equal(validateEntry('reminder', { title: 'Test', date: '2026-10-08', repeat_rule }).repeat_rule, repeat_rule);
  assert.throws(() => validateEntry('reminder', { title: 'Test', date: '2026-10-08', repeat_rule: 'Every century' }), /Repeat rule/);
  for (const frequency of ['Hourly', 'Monthly']) assert.throws(() => validateEntry('habit', { name: 'Read', frequency }), /Frequency/);
  assert.throws(() => validateEntry('todo_task', { title: 'Test', priority: 'Urgent' }), /Priority/);
  assert.throws(() => validateEntry('habit', { name: 'Test', is_temporary: 'false' }), /true or false/);
});

test('unsafe keys, prototypes, accessors, cycles, excessive depth and non-JSON values are rejected', () => {
  const poisoned = JSON.parse('{"title":"Test","metadata":{"__proto__":{"polluted":true}}}');
  assert.throws(() => validateEntry('todo_task', poisoned), /unsafe field/);
  assert.throws(() => validateEntry('todo_task', { title: 'Test', metadata: { constructor: {} } }), /unsafe field/);
  assert.throws(() => validateEntry('todo_task', Object.assign(Object.create({ hidden: true }), { title: 'Test' })), /object/);
  let getterRan = false;
  const computed = { title: 'Test', get notes() { getterRan = true; return 'bad'; } };
  assert.throws(() => validateEntry('todo_task', computed), /computed/);
  assert.equal(getterRan, false);
  const circular = { title: 'Test' }; circular.metadata = circular;
  assert.throws(() => validateEntry('todo_task', circular), /circular/);
  let nested = {}; for (let i = 0; i < 10; i++) nested = { nested };
  assert.throws(() => validateEntry('todo_task', { title: 'Test', nested }), /deeply nested/);
  for (const bad of [() => {}, Symbol('bad'), 1n, new Date(), undefined]) assert.throws(() => validateEntry('todo_task', { title: 'Test', metadata: bad }), /plain JSON/);
  assert.equal({}.polluted, undefined);
});

test('AI validator validates a ready entry and returns a detached sanitized copy', () => {
  const input = ai({ mode: 'proposal', data: { title: '  Call the vet  ' } });
  const result = validateAIResponse(input);
  assert.equal(result.data.title, 'Call the vet');
  assert.equal(input.data.title, '  Call the vet  ');
  assert.equal(result.detected_type, 'todo_task');
  const money = validateAIResponse(ai({ detected_type: 'expense', data: expense({ amount: '12.50' }) }));
  assert.equal(money.data.amount, 12.5);
});

test('AI answer mode works without an entry and cannot create data', () => {
  const result = validateAIResponse({ mode: 'answer', answer: ' You have three tasks. ' });
  assert.equal(result.reply, 'You have three tasks.');
  assert.equal(result.needs_more, false);
  assert.deepEqual(result.data, {});
  assert.equal(validateAIResponse({ mode: 'answer', reply: 'Hello', detected_type: 'unknown' }).reply, 'Hello');
  assert.throws(() => validateAIResponse({ mode: 'answer', reply: ' ' }), /empty/);
});

test('AI follow-ups accept unknown types or incomplete known entries, but validate supplied fields', () => {
  const unknown = validateAIResponse({ detected_type: 'unknown', needs_more: true, questions: [' What would you like to track? '] });
  assert.deepEqual(unknown.questions, ['What would you like to track?']);
  assert.deepEqual(unknown.data, {});
  const partial = validateAIResponse(ai({ detected_type: 'expense', needs_more: true, questions: ['How much?'], data: { date: '2026-10-08' } }));
  assert.equal(partial.data.amount, undefined);
  assert.throws(() => validateAIResponse(ai({ detected_type: 'expense', needs_more: true, data: expense({ amount: -1 }) })), /nonnegative/);
  assert.throws(() => validateAIResponse(ai({ detected_type: 'unknown' })), /clarification/);
  assert.throws(() => validateAIResponse({ mode: 'followup', detected_type: 'unknown', needs_more: false, reply: 'Question?' }), /more information/);
});

test('AI validator rejects malformed envelopes and unknown actions before saving', () => {
  for (const input of [null, [], 'json', 12, {}, { data: {} }]) assert.throws(() => validateAIResponse(input), /object|missing/);
  for (const extra of [
    { detected_type: 'delete_everything' }, { mode: 'execute' }, { data: [] }, { data: null },
    { needs_more: 'false' }, { confidence: -0.1 }, { confidence: 1.1 }, { confidence: '0.9' },
    { questions: 'Question?' }, { questions: [1] }, { questions: [''] }, { questions: ['One', 'Two', 'Three', 'Four'] },
    { reply: {} }, { data: { title: '' } }
  ]) assert.throws(() => validateAIResponse(ai(extra)), /AI|Title|Reply/);
  const missingData = ai(); delete missingData.data;
  assert.throws(() => validateAIResponse(missingData), /missing entry data/);
  const missingFlag = ai(); delete missingFlag.needs_more;
  assert.throws(() => validateAIResponse(missingFlag), /true or false/);
  assert.throws(() => validateAIResponse(JSON.parse('{"mode":"answer","reply":"ok","__proto__":{"polluted":true}}')), /unsafe field/);
  assert.throws(() => validateAIResponse(ai({ unused: { constructor: { prototype: { polluted: true } } } })), /unsafe field/);
});
