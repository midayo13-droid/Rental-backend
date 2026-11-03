import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { query, queryOne, tx } from '../common/db.js';
import { bad, unauthorized } from '../common/http.js';
import { Public, signToken } from './auth.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function mePayload(userId: number) {
  return queryOne<any>(
    `SELECT u.id, u.email, u.role, u.must_change_password,
            e.id AS employee_id, e.employee_no, e.name, e.department_id, d.name AS department_name,
            e.license_status, e.license_expiry
       FROM users u
       LEFT JOIN employees e ON e.user_id = u.id
       LEFT JOIN departments d ON d.id = e.department_id
      WHERE u.id = $1`,
    [userId],
  );
}

@Controller('auth')
export class AuthController {
  /** 고객 가입: 사번·이름이 직원 명부와 같아야 해요. [계-6] */
  @Public()
  @Post('signup')
  async signup(@Body() body: any) {
    const employeeNo = String(body?.employeeNo ?? '').trim();
    const name = String(body?.name ?? '').trim();
    const email = String(body?.email ?? '').trim();
    const password = String(body?.password ?? '');
    if (!employeeNo) throw bad('사번을 입력해 주세요.');
    if (!name) throw bad('이름을 입력해 주세요.');
    if (!EMAIL_RE.test(email)) throw bad('이메일 주소를 올바르게 입력해 주세요.');
    if (password.length < 8) throw bad('비밀번호는 8자 이상이어야 해요.');

    const emp = await queryOne<any>(
      `SELECT e.id, e.name, e.user_id, d.name AS department_name
         FROM employees e JOIN departments d ON d.id = e.department_id
        WHERE e.employee_no = $1`,
      [employeeNo],
    );
    if (!emp || emp.name !== name) throw bad('사번이나 이름이 직원 명부와 달라요. 다시 확인해 주세요.');
    if (emp.departmentName === '총무팀') throw bad('총무팀 직원 계정은 총무팀 관리자가 만들어 드려요.');
    if (emp.userId) throw bad('이미 가입된 직원이에요.');
    if (await queryOne('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email])) {
      throw bad('이미 가입된 이메일이에요.');
    }

    const hash = await bcrypt.hash(password, 10);
    const userId = await tx(async (q) => {
      const u = await q.queryOne<any>(
        `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, '고객') RETURNING id`,
        [email, hash],
      );
      await q.query('UPDATE employees SET user_id = $1 WHERE id = $2', [u!.id, emp.id]);
      return u!.id as number;
    });
    return { token: signToken(userId), user: await mePayload(userId) };
  }

  @Public()
  @Post('login')
  async login(@Body() body: any) {
    const email = String(body?.email ?? '').trim();
    const password = String(body?.password ?? '');
    const generic = '이메일이나 비밀번호를 다시 확인해 주세요.';
    if (!email || !password) throw unauthorized(generic);
    const u = await queryOne<any>('SELECT id, password_hash, status FROM users WHERE lower(email) = lower($1)', [email]);
    if (!u || !(await bcrypt.compare(password, u.passwordHash))) throw unauthorized(generic);
    if (u.status !== '사용') throw unauthorized('사용이 정지된 계정이에요. 총무팀에 문의해 주세요.');
    return { token: signToken(u.id), user: await mePayload(u.id) };
  }

  @Get('me')
  async me(@Req() req: any) {
    return mePayload(req.user.id);
  }

  @Post('change-password')
  async changePassword(@Req() req: any, @Body() body: any) {
    const current = String(body?.currentPassword ?? '');
    const next = String(body?.newPassword ?? '');
    if (next.length < 8) throw bad('새 비밀번호는 8자 이상이어야 해요.');
    const u = await queryOne<any>('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!u || !(await bcrypt.compare(current, u.passwordHash))) throw bad('현재 비밀번호가 맞지 않아요.');
    if (current === next) throw bad('새 비밀번호는 지금 비밀번호와 달라야 해요.');
    await query('UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2', [
      await bcrypt.hash(next, 10),
      req.user.id,
    ]);
    return { ok: true };
  }
}
