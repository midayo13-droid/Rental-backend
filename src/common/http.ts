import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';

/** 쉬운 말로 거절하는 오류들 */
export const bad = (message: string, extra: Record<string, unknown> = {}) =>
  new HttpException({ statusCode: 400, message, ...extra }, 400);
export const unauthorized = (message: string, extra: Record<string, unknown> = {}) =>
  new HttpException({ statusCode: 401, message, ...extra }, 401);
export const forbidden = (message: string, extra: Record<string, unknown> = {}) =>
  new HttpException({ statusCode: 403, message, ...extra }, 403);
export const notFound = (message: string) => new HttpException({ statusCode: 404, message }, 404);
export const conflict = (message: string, extra: Record<string, unknown> = {}) =>
  new HttpException({ statusCode: 409, message, ...extra }, 409);

/** 예상하지 못한 오류도 쉬운 말로 돌려줘요. (DB 주소 같은 내부 내용은 보여 주지 않아요) */
@Catch()
export class FriendlyErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      res.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body);
      return;
    }
    const code = (exception as any)?.code;
    const constraint: string = (exception as any)?.constraint ?? '';
    if (code === '23P01') {
      // 겹침 금지 제약 (동시에 신청이 들어왔을 때 DB가 마지막으로 막아요)
      const msg = constraint.includes('driver')
        ? '그 시간에는 이미 다른 차를 예약하셨어요.'
        : constraint.includes('maintenance')
          ? '그 기간에는 이미 점검 일정이 있어요.'
          : '그 시간에는 이미 예약이 있어요. 앞뒤 30분은 정리 시간이라 비워 둬요.';
      res.status(409).json({ statusCode: 409, message: msg });
      return;
    }
    if (code === '23505') {
      res.status(409).json({ statusCode: 409, message: '이미 등록된 내용이에요.' });
      return;
    }
    if (code === '23503') {
      res.status(409).json({ statusCode: 409, message: '다른 정보와 연결되어 있어서 처리할 수 없어요.' });
      return;
    }
    if (code === '23514') {
      res.status(400).json({ statusCode: 400, message: '입력한 값이 규칙에 맞지 않아요. 다시 확인해 주세요.' });
      return;
    }
    // 숫자 칸에 글자가 들어오거나(22P02), 범위를 넘거나(22003), 날짜 형식이 틀리거나(22007·22008), 글자가 너무 길 때(22001)
    if (['22P02', '22003', '22007', '22008', '22001'].includes(code)) {
      res.status(400).json({ statusCode: 400, message: '입력한 값의 형식이 올바르지 않아요. 다시 확인해 주세요.' });
      return;
    }
    const status = (exception as any)?.status ?? (exception as any)?.statusCode;
    if (status === 400) {
      res.status(400).json({ statusCode: 400, message: '보낸 내용을 읽을 수 없어요. 다시 시도해 주세요.' });
      return;
    }
    console.error('예상하지 못한 오류:', exception);
    res.status(500).json({ statusCode: 500, message: '서버에 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.' });
  }
}

/** 목록 쪽 나누기: page·size 가 오면 { items, total, page, size }, 없으면 전체 */
export function pageParams(q: any) {
  const size = q?.size ? Math.min(100, Math.max(1, Number(q.size) || 20)) : 0;
  const page = q?.page ? Math.max(1, Number(q.page) || 1) : 1;
  return { paged: size > 0, page, size, offset: (page - 1) * size };
}
export function pageResult<T>(items: T[], total: number, p: { paged: boolean; page: number; size: number }) {
  return p.paged ? { items, total, page: p.page, size: p.size } : { items, total, page: 1, size: items.length };
}

/** 받침에 맞는 조사를 붙여요. josa('쏘나타', '은/는') → 쏘나타는 */
export function josa(word: string, pair: '은/는' | '이/가' | '을/를'): string {
  const [withFinal, without] = pair.split('/');
  const c = word.charCodeAt(word.length - 1);
  const hasFinal = c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0;
  return word + (hasFinal ? withFinal : without);
}

export function str(v: unknown, label: string, opts: { max?: number; optional?: boolean } = {}): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) {
    if (opts.optional) return '';
    throw bad(`${josa(label, '을/를')} 입력해 주세요.`);
  }
  if (opts.max && s.length > opts.max) throw bad(`${josa(label, '은/는')} ${opts.max}자 이내로 적어 주세요.`);
  return s;
}

export function posInt(v: unknown, label: string): number {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) throw bad(`${josa(label, '은/는')} 1 이상의 정수로 적어 주세요.`);
  return n;
}
