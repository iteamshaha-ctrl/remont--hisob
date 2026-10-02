const DEFAULT_SETTINGS = {
  enabled: false,
  daily_time: '09:00',
  timezone: 'Asia/Tashkent',
  reminder_interval_minutes: 30,
};

const WIDGET_ID = 'remont-telegram-admin-widget';

export async function fetchTelegramSettings(supabase) {
  const { data, error } = await supabase
    .from('telegram_bot_settings')
    .select('*')
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return {
    ...DEFAULT_SETTINGS,
    ...(data || {}),
  };
}

export async function saveTelegramSettings(supabase, patch = {}) {
  const next = {
    id: 1,
    ...DEFAULT_SETTINGS,
    ...patch,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('telegram_bot_settings')
    .upsert(next, { onConflict: 'id' })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function ensureTelegramSettings(supabase) {
  try {
    return await fetchTelegramSettings(supabase);
  } catch (error) {
    console.error('Telegram settings could not be loaded:', error);
    return { ...DEFAULT_SETTINGS };
  }
}

function createWidget() {
  const existing = document.getElementById(WIDGET_ID);
  if (existing) return existing;

  const node = document.createElement('div');
  node.id = WIDGET_ID;
  node.style.position = 'fixed';
  node.style.right = '16px';
  node.style.bottom = '88px';
  node.style.width = '280px';
  node.style.maxWidth = 'calc(100vw - 24px)';
  node.style.padding = '14px';
  node.style.borderRadius = '18px';
  node.style.background = '#ffffff';
  node.style.border = '1px solid rgba(15, 23, 42, 0.08)';
  node.style.boxShadow = '0 12px 28px rgba(15, 23, 42, 0.12)';
  node.style.zIndex = '9999';
  node.style.fontFamily = 'Inter, sans-serif';
  node.style.color = '#0f172a';

  node.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <div>
        <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;font-weight:700;">Telegram</div>
        <div style="font-size:15px;font-weight:800;">Bot status</div>
      </div>
      <button id="remont-telegram-toggle" type="button" style="width:58px;height:32px;border:none;border-radius:999px;padding:4px;cursor:pointer;display:flex;align-items:center;transition:all .2s ease;background:#cbd5e1;">
        <span style="display:block;width:24px;height:24px;border-radius:50%;background:#fff;box-shadow:0 2px 8px rgba(15,23,42,0.15);transform:translateX(0);transition:transform .2s ease;"></span>
      </button>
    </div>

    <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px;">
      <label style="display:flex;flex-direction:column;gap:5px;font-size:12px;color:#475569;font-weight:600;">
        Daily reminder time
        <input id="remont-telegram-time" type="time" value="09:00" style="min-height:42px;border-radius:10px;border:1px solid rgba(15,23,42,0.08);background:#f8fafc;padding:0 12px;font-size:14px;color:#0f172a;" />
      </label>
      <div style="font-size:11px;color:#64748b;">Timezone: Asia/Tashkent</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button id="remont-telegram-link" type="button" style="flex:1;min-height:40px;border:none;border-radius:10px;background:#0f766e;color:#fff;font-weight:700;cursor:pointer;">Link worker</button>
        <button id="remont-telegram-refresh" type="button" style="flex:1;min-height:40px;border:none;border-radius:10px;background:#f1f5f9;color:#0f172a;font-weight:700;cursor:pointer;">Refresh</button>
      </div>
    </div>
  `;

  document.body.appendChild(node);
  return node;
}

function connectWidgetHandlers(supabase) {
  const widget = createWidget();
  const toggleButton = widget.querySelector('#remont-telegram-toggle');
  const timeInput = widget.querySelector('#remont-telegram-time');
  const refreshButton = widget.querySelector('#remont-telegram-refresh');
  const linkButton = widget.querySelector('#remont-telegram-link');

  const syncStatus = (settings) => {
    const enabled = !!settings.enabled;
    toggleButton.style.background = enabled ? '#14b8a6' : '#cbd5e1';
    toggleButton.querySelector('span').style.transform = enabled ? 'translateX(26px)' : 'translateX(0)';
    toggleButton.setAttribute('aria-label', enabled ? 'Telegram bot enabled' : 'Telegram bot disabled');
    timeInput.value = settings.daily_time || '09:00';
  };

  const loadSettings = async () => {
    try {
      const settings = await fetchTelegramSettings(supabase);
      syncStatus(settings);
    } catch (error) {
      console.error('Telegram admin widget settings error:', error);
    }
  };

  toggleButton.addEventListener('click', async () => {
    try {
      const current = await fetchTelegramSettings(supabase);
      const next = await saveTelegramSettings(supabase, { ...current, enabled: !current.enabled });
      syncStatus(next);
    } catch (error) {
      console.error('Telegram bot toggle failed:', error);
    }
  });

  timeInput.addEventListener('change', async (event) => {
    try {
      const current = await fetchTelegramSettings(supabase);
      const next = await saveTelegramSettings(supabase, { ...current, daily_time: event.target.value || '09:00' });
      syncStatus(next);
    } catch (error) {
      console.error('Telegram daily time update failed:', error);
    }
  });

  refreshButton.addEventListener('click', loadSettings);

  linkButton.addEventListener('click', async () => {
    const workerIdentifier = window.prompt('Telegram bilan bog' + "'" + 'lanadigan ishchi identifikatorini kiriting:', 'worker-1');
    if (!workerIdentifier) return;

    const chatId = window.prompt('Telegram chat ID ni kiriting (raqam):', '');
    if (!chatId) return;

    const username = window.prompt('Telegram username (ixtiyoriy):', '@');

    try {
      const { error } = await supabase.from('telegram_worker_links').upsert({
        user_id: (await supabase.auth.getUser()).data.user?.id ?? null,
        worker_identifier: workerIdentifier,
        chat_id: Number(chatId),
        telegram_username: username || null,
        status: 'active',
        last_verified_at: new Date().toISOString(),
      }, { onConflict: 'chat_id' });

      if (error) {
        throw error;
      }

      window.alert('Telegram bog' + "'" + 'lanishi saqlandi. Botda /start dan keyin tekshirish uchun Supabase Edge Function ishlatilishi kerak.');
    } catch (error) {
      console.error('Telegram worker link failed:', error);
      window.alert('Telegram bog' + "'" + 'lanishida xatolik yuz berdi.');
    }
  });

  loadSettings();
}

export function initTelegramAdminWidget(supabase) {
  if (!document || typeof window === 'undefined') {
    return;
  }

  const existing = document.getElementById(WIDGET_ID);
  if (existing) {
    return;
  }

  connectWidgetHandlers(supabase);
}

export default initTelegramAdminWidget;
