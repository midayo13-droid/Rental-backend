import 'dotenv/config';
import pg from 'pg';

// 날짜·시각은 시간대 계산 없이 글자 그대로 받아요. (모든 시각은 한국 시간)
pg.types.setTypeParser(1082, (v: string) => v); // DATE  → "2026-11-10"
pg.types.setTypeParser(1114, (v: string) => v.replace(' ', 'T').slice(0, 19)); // TIMESTAMP → "2026-11-10T09:00:00"
pg.types.setTypeParser(20, (v: string) => Number(v)); // bigint → 숫자
pg.types.setTypeParser(1700, (v: string) => parseFloat(v)); // numeric → 숫자

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL 이 backend/.env 에 없어요. .env.example 을 참고해 주세요.');
}

// 이 과제는 hw2 공간만 써요. (1주차 과제 테이블과 섞이지 않게)
export const SCHEMA = process.env.DB_SCHEMA ?? 'hw2';
if (SCHEMA !== 'hw2') {
  throw new Error(`DB_SCHEMA 는 hw2 여야 해요. (지금 값: ${SCHEMA})`);
}

const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);

export const pool = new pg.Pool({
  connectionString: url,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 5,
});

// 연결할 때마다 작업 공간을 hw2 로 고정해요. (public 은 확장 기능을 찾는 용도로만 뒤에 둬요)
pool.on('connect', (client) => {
  client.query(`SET search_path TO "${SCHEMA}", public`);
});

function camelKey(k: string) {
  return k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
/** DB 칸 이름(snake_case)을 화면용(camelCase)으로 바꿔요. */
export function camelize<T = any>(v: any): T {
  if (Array.isArray(v)) return v.map(camelize) as any;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const out: any = {};
    for (const [k, val] of Object.entries(v)) out[camelKey(k)] = camelize(val);
    return out;
  }
  return v;
}

export interface Q {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  queryOne<T = any>(sql: string, params?: any[]): Promise<T | null>;
}

function wrap(runner: { query: (sql: string, params?: any[]) => Promise<pg.QueryResult> }): Q {
  const query = async <T = any>(sql: string, params: any[] = []) => camelize<T[]>((await runner.query(sql, params)).rows);
  return {
    query,
    queryOne: async <T = any>(sql: string, params: any[] = []) => (await query<T>(sql, params))[0] ?? null,
  };
}

export const { query, queryOne } = wrap(pool);

/** 여러 저장을 한 번에 — 하나라도 실패하면 모두 취소돼요. */
export async function tx<T>(fn: (q: Q) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(wrap(client));
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
