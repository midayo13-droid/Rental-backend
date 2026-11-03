import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import jwt from 'jsonwebtoken';
import { queryOne } from '../common/db.js';
import { forbidden, unauthorized } from '../common/http.js';

export const JWT_SECRET = process.env.JWT_SECRET ?? '';
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET 이 backend/.env 에 없어요. .env.example 을 참고해 주세요.');
}

export type Role = '고객' | '일반 직원' | '관리자';
export interface AuthUser {
  id: number;
  role: Role;
  email: string;
  employeeId: number | null;
  name: string;
  departmentId: number | null;
  mustChangePassword: boolean;
}

export const isStaff = (role: string) => role === '일반 직원' || role === '관리자';

export const Public = () => SetMetadata('public', true);
/** 'staff' = 총무팀(일반 직원·관리자), 'admin' = 관리자만 */
export const Roles = (level: 'staff' | 'admin') => SetMetadata('level', level);

export function signToken(userId: number) {
  return jwt.sign({ uid: userId }, JWT_SECRET, { expiresIn: '8h' });
}

/** 모든 주소에서 로그인과 역할을 서버가 확인해요. (@Public 은 예외) */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>('public', targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers['authorization'] ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw unauthorized('로그인이 필요해요. 다시 로그인해 주세요.');

    let uid: number;
    try {
      uid = (jwt.verify(token, JWT_SECRET) as any).uid;
    } catch {
      throw unauthorized('로그인 시간이 끝났어요. 다시 로그인해 주세요.');
    }

    const row = await queryOne<any>(
      `SELECT u.id, u.role, u.email, u.status, u.must_change_password,
              e.id AS employee_id, e.name, e.department_id
         FROM users u LEFT JOIN employees e ON e.user_id = u.id
        WHERE u.id = $1`,
      [uid],
    );
    if (!row) throw unauthorized('로그인 정보를 찾을 수 없어요. 다시 로그인해 주세요.');
    // 사용 정지된 계정은 이미 받은 출입증도 바로 막혀요.
    if (row.status !== '사용') throw unauthorized('사용이 정지된 계정이에요. 총무팀에 문의해 주세요.');

    const user: AuthUser = {
      id: row.id,
      role: row.role,
      email: row.email,
      employeeId: row.employeeId ?? null,
      name: row.name ?? '',
      departmentId: row.departmentId ?? null,
      mustChangePassword: row.mustChangePassword,
    };
    req.user = user;

    // 임시 비밀번호로 들어왔으면 비밀번호를 바꾸기 전에는 다른 일을 할 수 없어요.
    if (user.mustChangePassword && !['/auth/me', '/auth/change-password'].includes(req.path)) {
      throw forbidden('임시 비밀번호예요. 먼저 새 비밀번호로 바꿔 주세요.', { code: 'MUST_CHANGE_PASSWORD' });
    }

    const level = this.reflector.getAllAndOverride<'staff' | 'admin' | undefined>('level', targets);
    if (level === 'staff' && !isStaff(user.role)) throw forbidden('쓸 수 없는 화면이에요. 총무팀만 쓸 수 있어요.');
    if (level === 'admin' && user.role !== '관리자') throw forbidden('이 일은 총무팀 관리자만 할 수 있어요.');
    return true;
  }
}
