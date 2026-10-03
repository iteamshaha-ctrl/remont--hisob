import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const supabase = createClient(SUPABASE_URL ?? '', SUPABASE_SERVICE_ROLE_KEY ?? '');

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

async function logEvent(eventType, status, message, payload, chatId = null, workerIdentifier = null) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;

  const { error } = await supabase.from('telegram_logs').insert({
    event_type: eventType,
    event_status: status,
    message,
    payload,
    chat_id: chatId,
    worker_identifier: workerIdentifier,
  });

  if (error) {
    console.error('telegram log failed', error);
  }
}

async function sendTelegramMessage(chatId, text, replyMarkup = null) {
  if (!BOT_TOKEN) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN');
  }

  const body = { chat_id: chatId, text, parse_mode: 'HTML', reply_markup: replyMarkup };
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const output = await res.json();
  if (!output.ok) {
    throw new Error(output.description || 'Telegram sendMessage failed');
  }

  return output.result;
}

function buildAttendanceKeyboard() {
  return {
    inline_keyboard: [[
      { text: 'Ha', callback_data: 'attendance_yes' },
      { text: "Yo'q", callback_data: 'attendance_no' },
    ]],
  };
}

function buildShiftKeyboard() {
  return {
    inline_keyboard: [[
      { text: '1 stavka', callback_data: 'shift_full' },
      { text: 'Yarim stavka', callback_data: 'shift_half' },
    ]],
  };
}

async function handleTextMessage(message) {
  const chatId = message.chat?.id;
  const username = message.from?.username || null;
  const text = message.text || '';

  if (!chatId) {
    return jsonResponse({ ok: false, error: 'Missing chat id' }, 400);
  }

  if (text === '/start') {
    await sendTelegramMessage(chatId, 'Assalomu alaykum! Telegram bilan ishlash uchun /link <code> buyrug\'ini yuboring.');
    await logEvent('telegram_start', 'success', 'Telegram /start received', { chat_id: chatId, username }, chatId, null);
    return jsonResponse({ ok: true, status: 'started' });
  }

  if (text.startsWith('/link ')) {
    const code = text.split(' ').slice(1).join(' ').trim();
    if (!code) {
      await sendTelegramMessage(chatId, 'Iltimos, kodni to\'g\'ri kiriting: /link ABC12345');
      return jsonResponse({ ok: true, status: 'link_failed' });
    }

    try {
      const { data, error } = await supabase.rpc('verify_telegram_link_code', {
        p_code: code,
        p_chat_id: Number(chatId),
        p_username: username,
      });

      if (error) throw error;
      if (!data?.ok) {
        await sendTelegramMessage(chatId, `Kodni tasdiqlashda xatolik: ${data?.error || 'Unknown error'}`);
        return jsonResponse({ ok: false, error: data?.error || 'Unknown error' }, 400);
      }

      await sendTelegramMessage(chatId, 'Telegram akkauntingiz muvaffaqiyatli bog\'landi. Bugungi ishga chiqish holatini javob berishda ko\'rsatilgan tugmalar orqali yuboring.');
      await logEvent('telegram_link_success', 'success', 'Telegram account linked', { chat_id: chatId, username, code }, chatId, data?.worker_identifier || null);
      return jsonResponse({ ok: true, data });
    } catch (error) {
      await logEvent('telegram_link_error', 'error', String(error), { chat_id: chatId, username, code }, chatId, null);
      await sendTelegramMessage(chatId, 'Bog\'lashda xatolik yuz berdi. Iltimos, kodni tekshiring yoki administratorga murojaat qiling.');
      return jsonResponse({ ok: false, error: String(error) }, 500);
    }
  }

  return jsonResponse({ ok: true, status: 'ignored' });
}

async function handleCallbackQuery(callbackQuery) {
  const chatId = callbackQuery.message?.chat?.id;
  const from = callbackQuery.from || {};
  const data = callbackQuery.data || '';
  const workerIdentifier = callbackQuery.data?.split('|')[1] || null;

  if (!chatId) {
    return jsonResponse({ ok: false, error: 'Missing callback chat id' }, 400);
  }

  try {
    if (data === 'attendance_yes') {
      await sendTelegramMessage(chatId, 'Ishga keldingizmi? Tanlang:', null, buildShiftKeyboard());
      return jsonResponse({ ok: true, status: 'prompted_for_shift' });
    }

    if (data === 'attendance_no') {
      const { data: result, error } = await supabase.rpc('record_telegram_daily_status', {
        p_user_id: from.id ? from.id.toString() : null,
        p_worker_identifier: workerIdentifier || `tg-${chatId}`,
        p_chat_id: Number(chatId),
        p_response_date: new Date().toISOString().slice(0, 10),
        p_status: 'day_off',
      });

      if (error) throw error;
      await sendTelegramMessage(chatId, 'Rozilik qabul qilindi. Bugungi dam olish holati qayd etildi.');
      return jsonResponse({ ok: true, data: result });
    }

    if (data === 'shift_full') {
      const { data: result, error } = await supabase.rpc('record_telegram_daily_status', {
        p_user_id: from.id ? from.id.toString() : null,
        p_worker_identifier: workerIdentifier || `tg-${chatId}`,
        p_chat_id: Number(chatId),
        p_response_date: new Date().toISOString().slice(0, 10),
        p_status: 'full',
      });

      if (error) throw error;
      await sendTelegramMessage(chatId, 'Tanlov qabul qilindi: 1 stavka.');
      return jsonResponse({ ok: true, data: result });
    }

    if (data === 'shift_half') {
      const { data: result, error } = await supabase.rpc('record_telegram_daily_status', {
        p_user_id: from.id ? from.id.toString() : null,
        p_worker_identifier: workerIdentifier || `tg-${chatId}`,
        p_chat_id: Number(chatId),
        p_response_date: new Date().toISOString().slice(0, 10),
        p_status: 'half',
      });

      if (error) throw error;
      await sendTelegramMessage(chatId, 'Tanlov qabul qilindi: Yarim stavka.');
      return jsonResponse({ ok: true, data: result });
    }

    return jsonResponse({ ok: true, status: 'callback_ignored' });
  } catch (error) {
    await logEvent('telegram_callback_error', 'error', String(error), { chat_id: chatId, data }, chatId, null);
    return jsonResponse({ ok: false, error: String(error) }, 500);
  }
}

Deno.serve(async (req) => {
  if (!WEBHOOK_SECRET) {
    return jsonResponse({ ok: false, error: 'Missing TELEGRAM_WEBHOOK_SECRET' }, 500);
  }

  const secret = req.headers.get('x-telegram-bot-api-secret-token') || req.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (!secret || secret !== WEBHOOK_SECRET) {
    await logEvent('telegram_webhook_forbidden', 'error', 'Invalid Telegram secret token', { source: 'webhook' }, null, null);
    return jsonResponse({ ok: false, error: 'Forbidden' }, 403);
  }

  try {
    const payload = await req.json();
    if (payload.callback_query) {
      return await handleCallbackQuery(payload.callback_query);
    }

    if (payload.message) {
      return await handleTextMessage(payload.message);
    }

    return jsonResponse({ ok: true, status: 'ignored' });
  } catch (error) {
    await logEvent('telegram_webhook_error', 'error', String(error), {}, null, null);
    return jsonResponse({ ok: false, error: String(error) }, 500);
  }
});
