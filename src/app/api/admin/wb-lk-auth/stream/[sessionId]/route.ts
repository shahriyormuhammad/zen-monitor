import { NextResponse } from 'next/server';

import { requireActiveTenant } from '@/lib/auth/tenant-access';
import { getAuthSession, subscribeEvents } from '@/lib/wb-rpa/auth-channel';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Ctx = { params: Promise<{ sessionId: string }> };

export async function GET(request: Request, context: Ctx) {
  const { tenantId } = await requireActiveTenant(request, ['owner', 'admin']);
  const { sessionId } = await context.params;

  const session = getAuthSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (session.tenantId !== tenantId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Initial event с текущим status, чтобы UI сразу понял где мы.
      controller.enqueue(encoder.encode(
        `event: status\ndata: ${JSON.stringify({ status: session.status })}\n\n`,
      ));

      // Heartbeat: SSE-комментарий каждые 15с. Пока ждём ввод SMS/captcha от
      // пользователя, событий нет и стрим простаивает — прокси (nginx) рвёт
      // простаивающее соединение через ~60с → "Связь с сервером прервалась".
      // Пинг держит соединение живым весь шаг RPA (до 5 мин).
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15_000);

      try {
        for await (const event of subscribeEvents(sessionId)) {
          const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(payload));
          if (event.type === 'completed') {
            // Дать клиенту дочитать
            await new Promise((r) => setTimeout(r, 100));
            break;
          }
        }
      } catch (error) {
        controller.enqueue(encoder.encode(
          `event: error\ndata: ${JSON.stringify({ message: (error as Error).message })}\n\n`,
        ));
      } finally {
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
