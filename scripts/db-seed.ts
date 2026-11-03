// 가상 데이터 채우기 (hw2 공간 안에서만). 사용:  npm run db:seed
// 모든 이름·계정·차량은 가상이에요. 이미 데이터가 있으면 멈춰요. (다시 하려면 npm run db:reset)
// 데이터 내용은 src/demo/demo-data.ts 에 있어요. (어드민의 "가상 데이터 다시 채우기"와 같은 데이터)
import 'dotenv/config';
import pg from 'pg';
import { DEMO_COUNTS, seedActivity, seedBase, type Run } from '../src/demo/demo-data.js';

const SCHEMA = process.env.DB_SCHEMA ?? 'hw2';
const url = process.env.DATABASE_URL;
if (SCHEMA !== 'hw2') {
  console.error(`DB_SCHEMA 는 hw2 여야 해요. (지금 값: ${SCHEMA})`);
  process.exit(1);
}
if (!url) {
  console.error('DATABASE_URL 이 backend/.env 에 없어요.');
  process.exit(1);
}

pg.types.setTypeParser(20, (v: string) => Number(v));
const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);
const client = new pg.Client({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });
const run: Run = async (sql, params) => (await client.query(sql, params)).rows;

async function main() {
  await client.connect();
  await client.query(`SET search_path TO "${SCHEMA}", public`);

  const exists = await client.query(`SELECT to_regclass($1) AS t`, [`${SCHEMA}.employees`]);
  if (!exists.rows[0].t) throw new Error('테이블이 없어요. 먼저 npm run db:init 을 실행해 주세요.');
  const n = await client.query('SELECT count(*)::int AS n FROM employees');
  if (n.rows[0].n > 0) {
    console.log('이미 데이터가 있어요. 다시 채우려면: npm run db:reset');
    return;
  }

  await client.query('BEGIN');
  try {
    await seedBase(run);
    await seedActivity(run);
    await client.query('COMMIT');
    console.log(`가상 데이터를 채웠어요: 부서 ${DEMO_COUNTS.departments}, 직원 명부 ${DEMO_COUNTS.employees}, 계정 ${DEMO_COUNTS.accounts}, 차량 ${DEMO_COUNTS.vehicles}, 예약 ${DEMO_COUNTS.reservations}, 정산 ${DEMO_COUNTS.claims} 등`);
    console.log('확인용 계정: admin@nuri.test(관리자) / staff1@nuri.test(일반 직원) / customer01@nuri.test(고객)');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

main()
  .catch((e) => {
    console.error('실패:', e.message);
    process.exitCode = 1;
  })
  .finally(() => client.end());
