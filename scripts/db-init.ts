// 테이블 만들기 (hw2 공간 안에서만). 사용:  npm run db:init   /   npm run db:init -- --reset
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const SCHEMA = process.env.DB_SCHEMA ?? 'hw2';
const url = process.env.DATABASE_URL;
const reset = process.argv.includes('--reset');

// 우리 테이블 이름 (이 11개만 다뤄요)
const OUR_TABLES = [
  'accidents', 'fuel_records', 'reservation_companions', 'trips', 'reservations',
  'maintenance_schedules', 'vehicles', 'employees', 'users', 'departments', 'personal_vehicle_claims',
];

if (SCHEMA !== 'hw2') {
  console.error(`안전을 위해 DB_SCHEMA 는 hw2 여야 해요. (지금 값: ${SCHEMA})`);
  process.exit(1);
}
if (!url) {
  console.error('DATABASE_URL 이 backend/.env 에 없어요. .env.example 을 보고 채워 주세요.');
  process.exit(1);
}

const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);
const client = new pg.Client({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });

async function main() {
  await client.connect();

  // 1) 읽기만: 지금 DB 에 어떤 공간과 테이블이 있는지 보여 줘요.
  const schemas = await client.query(
    `SELECT schema_name FROM information_schema.schemata
      WHERE schema_name NOT IN ('information_schema','pg_catalog','pg_toast') AND schema_name NOT LIKE 'pg_temp%' AND schema_name NOT LIKE 'pg_toast_temp%'
      ORDER BY 1`,
  );
  console.log('DB 안의 공간(스키마):', schemas.rows.map((r) => r.schema_name).join(', '));
  const mine = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY 1`,
    [SCHEMA],
  );
  const existing = mine.rows.map((r) => r.table_name as string);
  console.log(`${SCHEMA} 안의 테이블:`, existing.length ? existing.join(', ') : '(비어 있음)');

  // 2) hw2 안에 우리 것이 아닌 테이블이 있으면 멈춰요.
  const foreign = existing.filter((t) => !OUR_TABLES.includes(t));
  if (foreign.length > 0) {
    console.error(`\n${SCHEMA} 안에 이 과제 것이 아닌 테이블이 있어요: ${foreign.join(', ')}\n건드리지 않고 멈춰요. 확인해 주세요.`);
    process.exit(1);
  }

  // 3) --reset 이면 hw2 안의 우리 테이블만 지워요.
  if (reset) {
    for (const t of OUR_TABLES) {
      await client.query(`DROP TABLE IF EXISTS "${SCHEMA}"."${t}" CASCADE`);
    }
    console.log(`${SCHEMA} 안의 이 과제 테이블을 지웠어요.`);
  } else if (existing.length > 0) {
    console.log('이미 테이블이 만들어져 있어요. 다시 만들려면: npm run db:reset');
    return;
  }

  // 4) 스키마 SQL 실행
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const sql = fs.readFileSync(path.join(dir, '..', 'db', 'schema.sql'), 'utf8').replaceAll('__SCHEMA__', SCHEMA);
  await client.query(sql);
  console.log(`테이블 ${OUR_TABLES.length}개를 ${SCHEMA} 안에 만들었어요.`);
}

main()
  .catch((e) => {
    console.error('실패:', e.message);
    process.exitCode = 1;
  })
  .finally(() => client.end());
