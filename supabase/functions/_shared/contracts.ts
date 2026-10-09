// Pure contracts shared by the Edge Function and Node's TypeScript test runner.
export const ENTRY_TYPES = ['work_shift','expense','income','todo_task','todo_list','shopping_list','habit','workout_routine','calendar_event','reminder','note','unknown'] as const;
export type EntryType = typeof ENTRY_TYPES[number];
export class InputError extends Error {}
export function object(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v); }
function str(v: unknown, max: number, required = false): string {
  if (typeof v !== 'string' || v.length > max || (required && !v.trim())) throw new InputError('Invalid text field');
  return v.trim();
}
export function validDate(v: unknown): boolean {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T12:00:00Z');
  return Number.isFinite(+d) && d.toISOString().slice(0,10) === v;
}
export function validTimezone(v: unknown): v is string {
  try { if (typeof v !== 'string' || v.length > 80) return false; new Intl.DateTimeFormat('en', {timeZone:v}).format(); return true; } catch { return false; }
}
export function validateRequest(input: unknown) {
  if (!object(input) || Object.keys(input).some(k => !['message','history','include_finances'].includes(k))) throw new InputError('Invalid request');
  const message = str(input.message, 4000, true);
  const raw = input.history ?? [];
  if (!Array.isArray(raw) || raw.length > 8) throw new InputError('History is too long');
  const history = raw.map(x => {
    if (!object(x) || !['user','assistant'].includes(String(x.role))) throw new InputError('Invalid history');
    return {role:x.role as 'user'|'assistant', text:str(x.text, 2000, true)};
  });
  if (history.reduce((n,x)=>n+x.text.length,0) > 8000) throw new InputError('History is too long');
  if (input.include_finances !== undefined && typeof input.include_finances !== 'boolean') throw new InputError('Invalid finance opt-in');
  return {message, history, include_finances:input.include_finances === true};
}
const stringFields = ['date','work_type','start_time','end_time','notes','commute_trip','commute_vehicle','category','description','payment_type','title','priority','due_date','name','frequency','target_unit','reminder_time','time','repeat_rule'];
const numericFields = ['hours_worked','hourly_rate','cash_tips','digital_tips','amount','target_amount'];
const dataProperties: Record<string, unknown> = Object.fromEntries(stringFields.map(k=>[k,{type:['string','null']}]));
for (const k of numericFields) dataProperties[k] = {type:['number','null']};
dataProperties.items = {type:['array','null'],items:{type:'string'}};
dataProperties.is_temporary = {type:['boolean','null']};
export const responseSchema = {
  type:'object', additionalProperties:false,
  properties:{mode:{type:'string',enum:['answer','proposal']}, reply:{type:'string'},detected_type:{type:'string',enum:ENTRY_TYPES},confidence:{type:'number'},needs_more:{type:'boolean'},questions:{type:'array',items:{type:'string'}},summary_title:{type:'string'},data:{type:'object',additionalProperties:false,properties:dataProperties,required:Object.keys(dataProperties)}},
  required:['mode','reply','detected_type','confidence','needs_more','questions','summary_title','data']
};
const typeFields: Record<EntryType,string[]> = {
  work_shift:['date','work_type','start_time','end_time','hours_worked','hourly_rate','cash_tips','digital_tips','notes','commute_trip','commute_vehicle'],
  expense:['date','amount','category','description','payment_type','notes'],income:['date','amount','category','description','payment_type','notes'],
  todo_task:['title','category','priority','due_date','notes'],todo_list:['title','category','priority','items','notes'],shopping_list:['title','category','priority','items','notes'],
  habit:['name','description','frequency','target_amount','target_unit','reminder_time','is_temporary','notes'],workout_routine:['name','description','frequency','target_amount','target_unit','reminder_time','is_temporary','notes'],
  calendar_event:['title','date','time','repeat_rule','notes'],reminder:['title','date','time','repeat_rule','notes'],note:['title','notes'],unknown:[]
};
export function validateResponse(input: unknown) {
  if (!object(input) || !['answer','proposal'].includes(String(input.mode)) || !ENTRY_TYPES.includes(input.detected_type as EntryType) || typeof input.needs_more !== 'boolean' || typeof input.confidence !== 'number' || !Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1 || !Array.isArray(input.questions) || input.questions.length > 3 || !object(input.data)) throw new InputError('Invalid model output');
  const type = input.detected_type as EntryType;
  const reply = str(input.reply, 2400, true);
  const questions = input.questions.map(x=>str(x, 240, true));
  const data: Record<string, unknown> = {};
  for (const key of typeFields[type]) {
    const value = input.data[key];
    if (value == null) continue;
    if (numericFields.includes(key)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > (key === 'hours_worked' ? 24 : 1e8)) throw new InputError('Invalid model number');
    } else if (key === 'items') {
      if (!Array.isArray(value) || value.length > 100) throw new InputError('Invalid list');
      data[key] = value.map(x=>str(x,500,true)); continue;
    } else if (key === 'is_temporary') {
      if (typeof value !== 'boolean') throw new InputError('Invalid boolean');
    } else {
      str(value, key === 'notes' ? 10000 : key === 'description' ? 5000 : key === 'category' ? 100 : 200);
      if ((key === 'date' || key === 'due_date') && value !== '' && !validDate(value)) throw new InputError('Invalid date');
    }
    data[key] = value;
  }
  const enums: Record<string,string[]> = {priority:['High','Medium','Low'],frequency:['Daily','Weekly','Custom'],repeat_rule:['None','Daily','Weekly','Monthly','Custom'],payment_type:['cash','digital'],commute_trip:['none','one_way','round_trip'],target_unit:['reps','minutes','times','yes/no','custom']};
  for (const [key, values] of Object.entries(enums)) if (data[key] != null && data[key] !== '' && !values.includes(String(data[key]))) throw new InputError('Invalid enum');
  if (input.mode === 'answer') return {mode:'answer' as const,reply,detected_type:'unknown',confidence:input.confidence,needs_more:false,questions:[],summary_title:'',data:{}};
  if (!input.needs_more) {
    if (type === 'unknown') throw new InputError('Unknown proposal needs clarification');
    if (['expense','income'].includes(type) && !(Number(data.amount)>0)) throw new InputError('Amount is required');
    if (['work_shift','expense','income','calendar_event','reminder'].includes(type) && !validDate(data.date)) throw new InputError('Date is required');
    if (['todo_task','todo_list','shopping_list','calendar_event','reminder','note'].includes(type) && !String(data.title||'').trim()) throw new InputError('Title is required');
    if (['habit','workout_routine'].includes(type) && !String(data.name||'').trim()) throw new InputError('Name is required');
    if (type === 'work_shift' && (data.hourly_rate == null || !(Number(data.hours_worked)>0) && !(data.start_time && data.end_time))) throw new InputError('Shift needs hours and rate');
  }
  return {mode:'proposal' as const,reply,detected_type:type,confidence:input.confidence,needs_more:input.needs_more,questions,summary_title:str(input.summary_title,240),data};
}
export function localDate(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const p = Object.fromEntries(parts.map(x=>[x.type,x.value])); return `${p.year}-${p.month}-${p.day}`;
}
export function dayOffset(date: string, n: number) { const d=new Date(date+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
export function boundedRows(rows: Record<string,unknown>[], budget: number) {
  const output: Record<string,unknown>[] = []; let bytes=2;
  for (const row of rows) {
    const clean = Object.fromEntries(Object.entries(row).map(([k,v])=>[k,typeof v==='string'?v.slice(0,300):v]));
    const size = new TextEncoder().encode(JSON.stringify(clean)).length + 1;
    if (bytes+size>budget) return {rows:output,truncated:true}; output.push(clean); bytes+=size;
  }
  return {rows:output,truncated:false};
}
