import { Body, Controller, Get, HttpException, Post, Req } from '@nestjs/common';
import { bad } from '../common/http.js';

/** 규정 챗봇 — 질문을 Dify 로 전달해요. 키는 서버에만 있고, 질문·답은 저장하지 않아요. [챗-1]~[챗-6] */
@Controller('chat')
export class ChatController {
  private get connected() {
    return Boolean(process.env.DIFY_API_URL && process.env.DIFY_API_KEY);
  }

  @Get('status')
  status() {
    return { connected: this.connected };
  }

  @Post()
  async ask(@Req() req: any, @Body() body: any) {
    const message = String(body?.message ?? '').trim();
    if (!message) throw bad('궁금한 내용을 적어 주세요.');
    if (message.length > 500) throw bad('질문은 500자 이내로 적어 주세요.');
    if (!this.connected) {
      throw new HttpException(
        { statusCode: 503, message: '규정 챗봇이 아직 연결되지 않았어요. 규정 문서를 확인하거나 총무팀에 문의해 주세요.' },
        503,
      );
    }
    try {
      const res = await fetch(`${process.env.DIFY_API_URL!.replace(/\/$/, '')}/chat-messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.DIFY_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: {},
          query: message,
          response_mode: 'blocking',
          conversation_id: typeof body?.conversationId === 'string' ? body.conversationId : '',
          user: `user-${req.user.id}`,
        }),
      });
      if (!res.ok) throw new Error(`Dify ${res.status}`);
      const data: any = await res.json();
      return { answer: String(data.answer ?? ''), conversationId: data.conversation_id ?? '' };
    } catch {
      throw new HttpException({ statusCode: 502, message: '챗봇이 지금 답하지 못해요. 잠시 뒤 다시 시도해 주세요.' }, 502);
    }
  }
}
