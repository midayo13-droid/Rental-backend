import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { Roles } from '../auth/auth.js';
import { query, queryOne, tx } from '../common/db.js';
import { bad, conflict, forbidden, notFound, posInt } from '../common/http.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function tempPassword() {
  return `Tmp-${randomBytes(5).toString('hex')}`;
}

/** 총무팀 직원 계정 관리 — 관리자만. 회원가입 없이 관리자가 만들어요. */
@Roles('admin')
@Controller('accounts')
export class AccountsController {
  @Get()
  list() {
    return query(
      `SELECT u.id, u.email, u.role, u.status, u.must_change_password, u.created_at,
              e.id AS employee_id, e.employee_no, e.name, d.name AS department_name
         FROM users u JOIN employees e ON e.user_id = u.id JOIN departments d ON d.id = e.department_id
        WHERE u.role IN ('일반 직원', '관리자') ORDER BY u.role DESC, e.name`,
    );
  }

  /** 계정이 아직 없는 총무팀 직원 (계정 만들기 선택용) */
  @Get('candidates')
  candidates() {
    return query(
      `SELECT e.id, e.employee_no, e.name FROM employees e JOIN departments d ON d.id = e.department_id
        WHERE d.name = '총무팀' AND e.user_id IS NULL ORDER BY e.name`,
    );
  }

  @Post()
  async create(@Body() body: any) {
    const employeeId = posInt(body?.employeeId, '직원');
    const email = String(body?.email ?? '').trim();
    const role = body?.role === '관리자' ? '관리자' : '일반 직원';
    if (!EMAIL_RE.test(email)) throw bad('이메일 주소를 올바르게 입력해 주세요.');
    const emp = await queryOne<any>(
      `SELECT e.id, e.user_id, d.name AS department_name FROM employees e JOIN departments d ON d.id = e.department_id WHERE e.id = $1`,
      [employeeId],
    );
    if (!emp) throw notFound('직원을 찾을 수 없어요.');
    if (emp.departmentName !== '총무팀') throw bad('총무팀 직원만 직원 계정을 만들 수 있어요.');
    if (emp.userId) throw conflict('이미 계정이 있는 직원이에요.');
    if (await queryOne('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email])) throw conflict('이미 가입된 이메일이에요.');

    const temp = tempPassword();
    const hash = await bcrypt.hash(temp, 10);
    const id = await tx(async (q) => {
      const u = await q.queryOne<any>(
        `INSERT INTO users (email, password_hash, role, must_change_password) VALUES ($1, $2, $3, true) RETURNING id`,
        [email, hash, role],
      );
      await q.query('UPDATE employees SET user_id = $1 WHERE id = $2', [u!.id, employeeId]);
      return u!.id as number;
    });
    return { id, tempPassword: temp };
  }

  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const u = await queryOne<any>(`SELECT id, role FROM users WHERE id = $1 AND role IN ('일반 직원', '관리자')`, [Number(id)]);
    if (!u) throw notFound('직원 계정을 찾을 수 없어요.');
    if (u.id === req.user.id) throw forbidden('내 계정의 역할이나 사용 상태는 바꿀 수 없어요.');
    const role = body?.role === '관리자' || body?.role === '일반 직원' ? body.role : u.role;
    const status = body?.status === '정지' || body?.status === '사용' ? body.status : undefined;
    await query('UPDATE users SET role = $1, status = COALESCE($2, status) WHERE id = $3', [role, status ?? null, u.id]);
    return { ok: true };
  }

  /** 비밀번호 리셋 → 임시 비밀번호 발급, 다음 로그인 때 변경 강제 [계-4] */
  @Post(':id/reset-password')
  async reset(@Param('id') id: string) {
    const u = await queryOne<any>(`SELECT id FROM users WHERE id = $1 AND role IN ('일반 직원', '관리자')`, [Number(id)]);
    if (!u) throw notFound('직원 계정을 찾을 수 없어요.');
    const temp = tempPassword();
    await query('UPDATE users SET password_hash = $1, must_change_password = true WHERE id = $2', [
      await bcrypt.hash(temp, 10),
      u.id,
    ]);
    return { tempPassword: temp };
  }
}
