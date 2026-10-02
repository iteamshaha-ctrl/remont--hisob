# Remont Hisob

Multi-user remont hisoboti va ish haqi kuzatuv ilovasi.

## Lokal ishga tushirish

1. Supabase loyihasida `supabase/migrations/202609260001_telegram_integration.sql` migrationini ishga tushiring.
2. `.env.example` dagi environment variables ni `.env` yoki Vercel/hosting environmentiga ko'chiring.
3. `npm install` yoki `pnpm install` bilan bog'lanishlarni o'rnatib, `npm run build` orqali buildni tekshiring.
4. Supabase Edge Function'larni deploy qiling:
   - `supabase/functions/telegram-bot/index.ts`
   - `supabase/functions/telegram-daily-reminder/index.ts`
5. Telegram webhook URL ni `https://<project-ref>.supabase.co/functions/v1/telegram-bot` ga o'rnating va `x-telegram-bot-api-secret-token` headeriga `TELEGRAM_WEBHOOK_SECRET` ni kiritib, bot token bilan webhooksni sozlang.
6. Botni admin panel yoki database orqali ON/OFF qilish mumkin. Bot faolligini `telegram_bot_settings` jadvalidan tekshiring.

## Telegram integratsiyasi

- Admin panelda botning ON/OFF holati boshqariladi.
- `telegram_bot_settings` jadvali faollik, vaqt va timezone-ni saqlaydi.
- `telegram_worker_links` jadvali Telegram chat ID va ishchi identifikatorini xavfsiz bog'laydi.
- `telegram_link_tokens` uchun one-time link code ishlatiladi.
- `telegram_daily_statuses` jadvali har bir ishchi uchun bir kunda bitta javobni saqlaydi.
- `telegram_logs` barcha webhook/xatolik/duplikat holatlarini yozib turadi.
- Timezone: `Asia/Tashkent`.

## Muhim xotiralar

- Secretlar va bot token kodga hardcode qilinmaydi.
- Supabase mavjud ulanishi saqlanadi.
- Mavjud Remont Hisob app logikasi va dizayni o'zgartirilmaydi.
