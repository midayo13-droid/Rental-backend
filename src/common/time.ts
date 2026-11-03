import { bad, josa } from './http.js';

const fmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

/** 지금 한국 시각 "2026-11-03T19:20:11" */
export function nowKst(): string {
  return fmt.format(new Date()).replace(' ', 'T');
}
/** 오늘 한국 날짜 "2026-11-03" */
export function todayKst(): string {
  return nowKst().slice(0, 10);
}

/** 시각 글자("2026-11-10T09:00" 또는 공백 구분)를 "YYYY-MM-DDTHH:mm:ss" 로 맞춰요. */
export function normDateTime(v: unknown, label: string): string {
  const m = typeof v === 'string' ? v.trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/) : null;
  if (!m) throw bad(`${josa(label, '을/를')} 날짜와 시각으로 입력해 주세요.`);
  const out = `${m[1]}T${m[2]}:${m[3]}:${m[4] ?? '00'}`;
  if (Number.isNaN(ms(out))) throw bad(`${josa(label, '이/가')} 올바른 날짜가 아니에요.`);
  return out;
}
export function normDate(v: unknown, label: string): string {
  const m = typeof v === 'string' ? v.trim().match(/^(\d{4}-\d{2}-\d{2})$/) : null;
  if (!m || Number.isNaN(ms(`${m[1]}T00:00:00`))) throw bad(`${josa(label, '을/를')} 날짜로 입력해 주세요.`);
  return m[1];
}

/** 시각 글자를 밀리초로 (한국 시각 그대로 계산용) */
export function ms(s: string): number {
  return Date.parse(`${s.slice(0, 19)}Z`);
}
export function addMinutes(s: string, minutes: number): string {
  return new Date(ms(s) + minutes * 60000).toISOString().slice(0, 19);
}
export function addDays(date: string, days: number): string {
  return new Date(ms(`${date}T00:00:00`) + days * 86400000).toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string): number {
  return Math.round((ms(`${to}T00:00:00`) - ms(`${from}T00:00:00`)) / 86400000);
}
/** "11월 10일 09:00" */
export function human(s: string): string {
  return `${Number(s.slice(5, 7))}월 ${Number(s.slice(8, 10))}일 ${s.slice(11, 16)}`;
}
export function humanDate(d: string): string {
  return `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;
}
/** "2026-11" 형태의 월(없으면 이번 달) → { from: "2026-11-01", to: "2026-12-01" } */
export function monthRange(month?: string) {
  const m = typeof month === 'string' && /^\d{4}-\d{2}$/.test(month) ? month : todayKst().slice(0, 7);
  const from = `${m}-01`;
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  const to = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`;
  return { month: m, from, to };
}
