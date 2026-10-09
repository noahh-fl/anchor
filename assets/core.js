/* Anchor's side-effect-free validation and recurrence helpers.
 * Keep this file usable in browsers and Node so the same rules guard every save.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.AnchorCore = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const TYPES = Object.freeze(['work_shift', 'expense', 'income', 'todo_task', 'todo_list', 'shopping_list', 'habit', 'workout_routine', 'calendar_event', 'reminder', 'note']);
  const REPEAT_RULES = Object.freeze(['None', 'Daily', 'Weekly', 'Monthly', 'Custom']);
  const MAX_LIST_ITEMS = 100;
  const MAX_ITEM_LENGTH = 500;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const present = value => value !== undefined && value !== null && value !== '';
  const label = key => key.replace(/_/g, ' ').replace(/^./, char => char.toUpperCase());

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    if (year < 1 || month < 1 || month > 12 || day < 1) return false;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  }

  // Accept 9, 09:30, 21:30, 930, 0930, 9am, and 9:30 PM. Never roll an invalid time over.
  function parseTime(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    let match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(text);
    if (!match) {
      const compact = /^(\d{1,2})(\d{2})\s*(am|pm)?$/i.exec(text);
      if (compact) match = compact;
    }
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    const period = (match[3] || '').toLowerCase();
    if (minute > 59 || (period ? hour < 1 || hour > 12 : hour > 23)) return null;
    if (period) hour = (hour % 12) + (period === 'pm' ? 12 : 0);
    return hour + minute / 60;
  }

  // Recurrences use calendar dates in UTC, avoiding DST and host-timezone shifts.
  // Monthly means the same day number, skipping months which do not have that day.
  // Legacy Custom rules have no schedule definition, so only the original date is shown.
  function occursOn(reminder, dateString) {
    if (!reminder || typeof reminder !== 'object' || !validDate(dateString)) return false;
    const start = reminder.date || reminder.start_date;
    if (!validDate(start) || dateString < start) return false;
    if (present(reminder.start_date) && (!validDate(reminder.start_date) || dateString < reminder.start_date)) return false;
    if (present(reminder.end_date) && (!validDate(reminder.end_date) || dateString > reminder.end_date)) return false;
    switch (reminder.repeat_rule || 'None') {
      case 'Daily': return true;
      case 'Weekly': return (Date.parse(dateString + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) % (7 * 86400000) === 0;
      case 'Monthly': return dateString.slice(8, 10) === start.slice(8, 10);
      default: return dateString === start;
    }
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  // Validate the entire tree before reading fields, including unused fields. No getters,
  // cyclic objects, prototype keys, or non-JSON values can leak into saved app state.
  function safeCopy(value) {
    const active = new Set();
    let nodes = 0;
    let characters = 0;
    function copy(input, depth) {
      if (++nodes > 5000 || depth > 8) throw new Error('Entry is too large or deeply nested.');
      if (input === null || typeof input === 'boolean') return input;
      if (typeof input === 'string') {
        characters += input.length;
        if (input.length > 20000 || characters > 100000) throw new Error('Entry text is too long.');
        if (input.includes('\u0000')) throw new Error('Entry text contains an unsupported character.');
        return input;
      }
      if (typeof input === 'number') {
        if (!Number.isFinite(input)) throw new Error('Numbers must be finite.');
        return input;
      }
      if (typeof input !== 'object' || (!Array.isArray(input) && !isPlainObject(input))) throw new Error('Entry must contain only plain JSON data.');
      if (active.has(input)) throw new Error('Entry must not contain circular references.');
      active.add(input);
      const keys = Reflect.ownKeys(input);
      if (keys.some(key => typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key))) throw new Error('Entry contains an unsafe field.');
      if ((Array.isArray(input) && input.length > MAX_LIST_ITEMS) || keys.length > 150) throw new Error('Entry contains too many items or fields.');
      if (Array.isArray(input) && keys.length !== input.length + 1) throw new Error('List items must not be empty slots.');
      const output = Array.isArray(input) ? [] : {};
      for (const key of keys) {
        if (Array.isArray(input) && key === 'length') continue;
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !own(descriptor, 'value')) throw new Error('Entry must not contain computed properties.');
        if (Array.isArray(input) && !/^(0|[1-9]\d*)$/.test(key)) throw new Error('List contains an unsupported field.');
        output[key] = copy(descriptor.value, depth + 1);
      }
      if (Array.isArray(input) && output.length !== input.length) throw new Error('List items must not be empty slots.');
      active.delete(input);
      return output;
    }
    return copy(value, 0);
  }

  function textField(data, key, max, required) {
    const value = data[key];
    if (value === undefined || value === null) {
      if (required) throw new Error(label(key) + ' is required.');
      return;
    }
    if (typeof value !== 'string') throw new Error(label(key) + ' must be text.');
    data[key] = value.trim();
    if (required && !data[key]) throw new Error(label(key) + ' is required.');
    if (data[key].length > max) throw new Error(label(key) + ' must be ' + max + ' characters or fewer.');
  }

  function numberField(data, key, required) {
    let value = data[key];
    if (typeof value === 'string') value = value.trim();
    if (!present(value)) {
      if (required) throw new Error(label(key) + ' is required.');
      if (own(data, key)) data[key] = null;
      return;
    }
    if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value))) {
      throw new Error(label(key) + ' must be a nonnegative, finite number.');
    }
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error(label(key) + ' must be a nonnegative, finite number.');
    data[key] = number === 0 ? 0 : number;
  }

  function enumField(data, key, choices) {
    if (!present(data[key])) return;
    if (!choices.includes(data[key])) throw new Error(label(key) + ' must be one of: ' + choices.join(', ') + '.');
  }

  function validateEntryData(type, input, partial) {
    if (!TYPES.includes(type)) throw new Error('Unsupported entry type.');
    if (!isPlainObject(input)) throw new Error('Entry data must be an object.');
    const data = safeCopy(input);
    const titleRequired = ['todo_task', 'todo_list', 'shopping_list', 'calendar_event', 'reminder', 'note'].includes(type);
    const nameRequired = ['habit', 'workout_routine'].includes(type);
    textField(data, 'title', 200, titleRequired && !partial);
    textField(data, 'name', 200, nameRequired && !partial);
    textField(data, 'work_type', 200, false);
    textField(data, 'category', 100, false);
    textField(data, 'description', 5000, false);
    textField(data, 'notes', 10000, false);
    textField(data, 'commute_vehicle', 200, false);

    const dateRequired = ['work_shift', 'expense', 'income', 'calendar_event', 'reminder'].includes(type);
    for (const key of ['date', 'due_date', 'start_date', 'end_date']) {
      if (!present(data[key])) {
        if (key === 'date' && dateRequired && !partial) throw new Error('Date is required.');
        if (own(data, key)) data[key] = null;
      } else if (!validDate(data[key])) throw new Error(label(key) + ' must be a real date in YYYY-MM-DD format.');
    }
    const start = data.start_date || data.date;
    if (start && data.end_date && data.end_date < start) throw new Error('End date must be on or after the start date.');
    for (const key of ['time', 'start_time', 'end_time', 'reminder_time']) {
      if (!present(data[key])) {
        if (own(data, key)) data[key] = null;
      } else {
        if (parseTime(data[key]) === null) throw new Error(label(key) + ' must be a valid time, such as 9:30 AM or 21:30.');
        data[key] = data[key].trim();
      }
    }
    for (const key of ['amount', 'hours_worked', 'hourly_rate', 'cash_tips', 'digital_tips', 'total_tips', 'wage_pay', 'total_shift_income', 'tips_per_hour', 'target_amount', 'commute_miles', 'commute_cost']) {
      numberField(data, key, key === 'amount' && ['expense', 'income'].includes(type) && !partial);
    }
    enumField(data, 'repeat_rule', REPEAT_RULES);
    enumField(data, 'frequency', ['Daily', 'Weekly', 'Custom']);
    enumField(data, 'priority', ['High', 'Medium', 'Low']);
    enumField(data, 'commute_trip', ['round_trip', 'one_way', 'none']);
    enumField(data, 'payment_type', ['cash', 'digital']);
    enumField(data, 'target_unit', ['reps', 'minutes', 'times', 'yes/no', 'custom']);
    if (own(data, 'is_temporary') && data.is_temporary !== null && typeof data.is_temporary !== 'boolean') throw new Error('Is temporary must be true or false.');

    if (own(data, 'items')) {
      if (!Array.isArray(data.items)) throw new Error('List items must be an array of text.');
      if (data.items.length > MAX_LIST_ITEMS) throw new Error('Lists can have at most ' + MAX_LIST_ITEMS + ' items.');
      data.items = data.items.map(item => {
        if (typeof item !== 'string' || !item.trim()) throw new Error('Each list item must contain text.');
        if (item.trim().length > MAX_ITEM_LENGTH) throw new Error('Each list item must be ' + MAX_ITEM_LENGTH + ' characters or fewer.');
        return item.trim();
      });
    } else if (['todo_list', 'shopping_list'].includes(type) && !partial) data.items = [];
    return data;
  }

  function validateEntry(type, data) {
    return validateEntryData(type, data, false);
  }

  function validateAIResponse(input) {
    if (!isPlainObject(input)) throw new Error('AI response must be a JSON object.');
    const result = safeCopy(input);
    if (own(result, 'mode') && !['answer', 'proposal', 'entry', 'followup', 'follow_up'].includes(result.mode)) throw new Error('AI response has an unsupported mode.');
    for (const key of ['reply', 'answer', 'summary_title']) textField(result, key, key === 'summary_title' ? 300 : 10000, false);
    if (own(result, 'confidence') && (typeof result.confidence !== 'number' || result.confidence < 0 || result.confidence > 1)) throw new Error('AI confidence must be a number between 0 and 1.');
    if (own(result, 'needs_more') && typeof result.needs_more !== 'boolean') throw new Error('AI needs_more must be true or false.');
    if (own(result, 'questions')) {
      if (!Array.isArray(result.questions) || result.questions.length > 3 || result.questions.some(question => typeof question !== 'string' || !question.trim() || question.length > 500)) throw new Error('AI questions must contain at most three short questions.');
      result.questions = result.questions.map(question => question.trim());
    } else result.questions = [];
    if (own(result, 'data') && !isPlainObject(result.data)) throw new Error('AI entry data must be an object.');
    if (own(result, 'detected_type') && result.detected_type !== 'unknown' && !TYPES.includes(result.detected_type)) throw new Error('AI response has an unsupported entry type.');

    if (result.mode === 'answer') {
      if (!result.reply && !result.answer) throw new Error('AI answer is empty.');
      result.reply = result.reply || result.answer;
      result.needs_more = false;
      result.data = {};
      return result;
    }
    if (['followup', 'follow_up'].includes(result.mode) && result.needs_more !== true) throw new Error('AI follow-up must request more information.');
    if (!own(result, 'detected_type')) throw new Error('AI response is missing its entry type.');
    if (typeof result.needs_more !== 'boolean') throw new Error('AI needs_more must be true or false.');
    if (result.detected_type === 'unknown') {
      if (!result.needs_more || (!result.reply && !result.questions.length)) throw new Error('AI must ask for clarification before saving an unknown entry.');
      result.data = result.data || {};
      return result;
    }
    if (!own(result, 'data')) throw new Error('AI response is missing entry data.');
    if (result.needs_more && !result.reply && !result.questions.length) throw new Error('AI follow-up is missing its question.');
    result.data = validateEntryData(result.detected_type, result.data, result.needs_more);
    return result;
  }

  return Object.freeze({ validDate, parseTime, occursOn, validateEntry, validateAIResponse, TYPES, REPEAT_RULES, MAX_LIST_ITEMS, MAX_ITEM_LENGTH });
});
