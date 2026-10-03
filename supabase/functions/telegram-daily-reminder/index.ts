import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');

const supabase = createClient(SUPABASE_URL ?? '', SUPABASE_SERVICE_ROLE_KEY ?? '');

function isTashkentWindow(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tashkent',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return formatter.format(date);
}

async function sendReminder(chatId, workerIdentifier) {
  if (!BOT_TOKEN) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN');
  }

  const keyboard = {
    inline_keyboard: [[
      { text: 'Ha', callback_data: `attendance_yes|${workerIdentifier}` },
      { text: "Yo'q", callback_data: `attendance_no|${workerIdentifier}` },
    ]],
  };

  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: 'Ishga chiqdingizmi?',
      reply_markup: keyboard,
    }),
  });

  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(payload.description || 'Bot reminder failed');
  }

  return payload.result;
}

Deno.serve(async () => {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing Supabase env vars' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const { data: settings, error: settingsError } = await supabase
      .from('telegram_bot_settings')
      .select('*')
      .maybeSingle();

    if (settingsError) throw settingsError;
    if (!settings?.enabled) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'telegram_disabled' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const tzTime = isTashkentWindow();
    const currentTime = tzTime.trim();
    const targetTime = settings.daily_time || '09:00';

    if (currentTime !== targetTime) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'not_due_yet', current_time: currentTime, target_time: targetTime }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const { data: links, error: linksError } = await supabase
      .from('telegram_worker_links')
      .select('*')
      .eq('status', 'active');

    if (linksError) throw linksError;

    const today = new Date().toISOString().slice(0, 10);
    const sent = [];

    for (const link of links ?? []) {
      const { data: existsData } = await supabase
        .from('telegram_daily_statuses')
        .select('id')
        .eq('worker_identifier', link.worker_identifier)
        .eq('response_date', today)
        .maybeSingle();

      if (existsData) continue;

      await sendReminder(link.chat_id, link.worker_identifier);
      sent.push({ worker_identifier: link.worker_identifier, chat_id: link.chat_id });
    }

    await supabase.from('telegram_logs').insert({
      event_type: 'telegram_daily_reminder_run',
      event_status: 'success',
      message: 'Daily Telegram reminders sent',
      payload: { sent_count: sent.length, sent },
    });

    return new Response(JSON.stringify({ ok: true, sent_count: sent.length, sent }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    await supabase.from('telegram_logs').insert({
      event_type: 'telegram_daily_reminder_run',
      event_status: 'error',
      message: String(error),
      payload: { error: String(error) },
    });

    return new Response(JSON.stringify({ ok: false, error: String(error) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
