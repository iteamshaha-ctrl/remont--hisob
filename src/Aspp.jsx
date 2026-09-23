import { supabase } from "./supabaseClient";
import { isValidLoginId, loginIdToEmail, normalizeLoginId } from "./auth";
import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Hammer, Home, CalendarDays, Settings2, Users, Plus, Trash2, Check, Loader2,
  Lock, Eye, LogOut, Bell, ChevronLeft, ChevronRight, Package, UtensilsCrossed,
  Wallet, Archive, ArchiveRestore, ListChecks, Calculator, Download, X,
} from "lucide-react";
import * as XLSX from "xlsx";

const uid = () => Math.random().toString(36).slice(2, 10);
const todayISO = () => new Date().toISOString().slice(0, 10);
const MONTHS = ["Yanvar","Fevral","Mart","Aprel","May","Iyun","Iyul","Avgust","Sentabr","Oktabr","Noyabr","Dekabr"];
const WEEKDAYS = ["Du","Se","Cho","Pa","Ju","Sha","Ya"];
const fmtDate = (iso) => {
  const d = new Date(iso + "T00:00:00");
  return `${d.getDate()} ${MONTHS[d.getMonth()].toLowerCase()}`;
};
const fmtMoney = (n) => Math.round(n).toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₸";

const DEFAULT_STAGE_NAMES = ["Demontaj", "Elektr montaji", "Santexnika", "Shpaklyovka", "Bo'yoq/oboy", "Pol qoplamasi", "Yakuniy tozalash"];
const makeStages = () => DEFAULT_STAGE_NAMES.map((name) => ({ id: uid(), name, done: false }));

const DEFAULT_DATA = {
  workers: Array.from({ length: 7 }, (_, i) => ({ id: uid(), name: `Ishchi ${i + 1}` })),
  apartments: [
    { id: uid(), name: "Kvartira 1", budget: 9000, status: "active", stages: makeStages() },
    { id: uid(), name: "Kvartira 2", budget: 9000, status: "active", stages: makeStages() },
  ],
  entries: [], // {id, date, workerId, apartmentId, status: 'full'|'half'}
  expenses: [], // {id, apartmentId, name, amount, category: 'ovqat'|'material', participantIds: []}
  payments: [], // {id, workerId, amount, date}
  quickCalc: { title: "", totalBudget: 0, rows: [] }, // {rows: [{id, name, days}]}
};

const STORAGE_KEY = "remont-tracker-v2";

function normalize(parsed) {
  const d = { ...DEFAULT_DATA, ...parsed };
  d.apartments = (d.apartments || []).map((a) => ({
    ...a,
    status: a.status || "active",
    stages: a.stages && a.stages.length ? a.stages : makeStages(),
  }));
  d.expenses = (d.expenses || []).map((ex) => ({ ...ex, category: ex.category || "ovqat" }));
  d.payments = d.payments || [];
  d.quickCalc = d.quickCalc && Array.isArray(d.quickCalc.rows) ? d.quickCalc : { title: "", totalBudget: 0, rows: [] };
  const clean = { ...d };
  delete clean.editPin;
  return clean;
}

function TickDivider({ label }) {
  return (
    <div className="tick-divider">
      <div className="tick-line" />
      {label && <span className="tick-label">{label}</span>}
      <div className="tick-line" />
    </div>
  );
}

function ProgressRing({ pct, size = 52 }) {
  return (
    <div className="ring" style={{ "--pct": pct, width: size, height: size }}>
      <div className="ring-inner">{pct}%</div>
    </div>
  );
}

export default function RemontTracker() {
  const [data, setData] = useState(DEFAULT_DATA);
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("hisobot");
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [draft, setDraft] = useState({});
  const remoteApply = useRef(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      if (mounted) { setSession(currentSession); setAuthReady(true); }
    }).catch((error) => {
      console.error("Sessionni yuklashda xatolik", error);
      if (mounted) setAuthReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      if (!nextSession) { setData(normalize(DEFAULT_DATA)); setLoaded(false); }
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!session?.user?.id) return () => { cancelled = true; };
    setLoaded(false);
    (async () => {
      try {
        const { data: row, error } = await supabase.from("user_app_state").select("data").eq("user_id", session.user.id).maybeSingle();
        if (error) throw error;
        let state = row?.data;
        if (!state) {
          const { data: legacyState, error: legacyError } = await supabase.rpc("claim_legacy_state");
          if (legacyError) throw legacyError;
          state = legacyState;
        }
        if (!cancelled) setData(normalize(state || DEFAULT_DATA));
      } catch (error) {
        console.error("Ma'lumotlarni yuklashda xatolik", error);
        if (!cancelled) setData(normalize(DEFAULT_DATA));
      } finally { if (!cancelled) setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!loaded || !session?.user?.id) return;
    if (remoteApply.current) { remoteApply.current = false; return; }
    setSaving(true);
    const t = setTimeout(async () => {
      try {
        const { error } = await supabase.from("user_app_state").upsert({ user_id: session.user.id, data, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
        if (error) throw error;
      } catch (error) { console.error("Saqlashda xatolik", error); }
      finally { setSaving(false); }
    }, 500);
    return () => clearTimeout(t);
  }, [data, loaded, session?.user?.id]);

  useEffect(() => {
    if (!loaded || !session?.user?.id) return;
    const interval = setInterval(async () => {
      if (saving) return;
      try {
        const { data: row, error } = await supabase.from("user_app_state").select("data").eq("user_id", session.user.id).maybeSingle();
        if (error) throw error;
        if (row?.data && JSON.stringify(row.data) !== JSON.stringify(data)) {
          remoteApply.current = true;
          setData(normalize(row.data));
        }
      } catch (error) { console.error("Yangilanishni tekshirishda xatolik", error); }
    }, 6000);
    return () => clearInterval(interval);
  }, [loaded, data, saving, session?.user?.id]);

  useEffect(() => {
    const forDate = data.entries.filter((e) => e.date === selectedDate);
    const next = {};
    data.workers.forEach((w) => {
      const existing = forDate.find((e) => e.workerId === w.id);
      next[w.id] = existing ? { apartmentId: existing.apartmentId, status: existing.status } : { apartmentId: null, status: "full" };
    });
    setDraft(next);
    // eslint-disable-next-line
  }, [selectedDate, loaded]);

  const setDraftFor = (workerId, patch) => setDraft((d) => ({ ...d, [workerId]: { ...d[workerId], ...patch } }));

  const saveDay = () => {
    setData((d) => {
      const rest = d.entries.filter((e) => e.date !== selectedDate);
      const additions = Object.entries(draft)
        .filter(([, v]) => v.apartmentId)
        .map(([workerId, v]) => ({ id: uid(), date: selectedDate, workerId, apartmentId: v.apartmentId, status: v.status }));
      return { ...d, entries: [...rest, ...additions] };
    });
  };

  const loggedDates = useMemo(() => Array.from(new Set(data.entries.map((e) => e.date))), [data.entries]);
  const activeApartments = useMemo(() => data.apartments.filter((a) => a.status !== "archived"), [data.apartments]);

  const report = useMemo(() => {
    return data.apartments.map((apt) => {
      const aptEntries = data.entries.filter((e) => e.apartmentId === apt.id);
      const points = {};
      aptEntries.forEach((e) => { points[e.workerId] = (points[e.workerId] || 0) + (e.status === "full" ? 1 : 0.5); });
      const totalPoints = Object.values(points).reduce((a, b) => a + b, 0);

      const aptExpenses = data.expenses.filter((ex) => ex.apartmentId === apt.id);
      const materialExpenses = aptExpenses.filter((ex) => ex.category === "material");
      const foodExpenses = aptExpenses.filter((ex) => ex.category !== "material");
      const sharedFood = foodExpenses.filter((ex) => !ex.participantIds || ex.participantIds.length === 0);
      const targetedFood = foodExpenses.filter((ex) => ex.participantIds && ex.participantIds.length > 0);
      const materialTotal = materialExpenses.reduce((s, ex) => s + ex.amount, 0);
      const sharedFoodTotal = sharedFood.reduce((s, ex) => s + ex.amount, 0);
      const foodTotal = foodExpenses.reduce((s, ex) => s + ex.amount, 0);
      const netBudget = Math.max(0, apt.budget - materialTotal - sharedFoodTotal);

      const earnings = {};
      data.workers.forEach((w) => { earnings[w.id] = totalPoints > 0 ? (netBudget * (points[w.id] || 0)) / totalPoints : 0; });
      targetedFood.forEach((ex) => {
        const share = ex.amount / ex.participantIds.length;
        ex.participantIds.forEach((wid) => { earnings[wid] = (earnings[wid] || 0) - share; });
      });

      const doneStages = apt.stages.filter((s) => s.done).length;
      const progressPct = apt.stages.length ? Math.round((doneStages / apt.stages.length) * 100) : 0;

      return { apt, points, totalPoints, earnings, netBudget, materialTotal, foodTotal, progressPct };
    });
  }, [data]);

  const workerTotals = useMemo(() => {
    const totals = {};
    data.workers.forEach((w) => (totals[w.id] = 0));
    report.forEach((r) => data.workers.forEach((w) => (totals[w.id] += r.earnings[w.id] || 0)));
    return totals;
  }, [report, data.workers]);

  const addWorker = () => setData((d) => ({ ...d, workers: [...d.workers, { id: uid(), name: `Ishchi ${d.workers.length + 1}` }] }));
  const removeWorker = (id) => setData((d) => ({ ...d, workers: d.workers.filter((w) => w.id !== id), entries: d.entries.filter((e) => e.workerId !== id) }));
  const renameWorker = (id, name) => setData((d) => ({ ...d, workers: d.workers.map((w) => (w.id === id ? { ...w, name } : w)) }));

  const addApartment = () => setData((d) => ({ ...d, apartments: [...d.apartments, { id: uid(), name: `Kvartira ${d.apartments.length + 1}`, budget: 9000, status: "active", stages: makeStages() }] }));
  const removeApartment = (id) => setData((d) => ({ ...d, apartments: d.apartments.filter((a) => a.id !== id), entries: d.entries.filter((e) => e.apartmentId !== id), expenses: d.expenses.filter((ex) => ex.apartmentId !== id) }));
  const updateApartment = (id, patch) => setData((d) => ({ ...d, apartments: d.apartments.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  const toggleArchive = (id) => setData((d) => ({ ...d, apartments: d.apartments.map((a) => (a.id === id ? { ...a, status: a.status === "archived" ? "active" : "archived" } : a)) }));
  const toggleStage = (aptId, stageId) => setData((d) => ({
    ...d,
    apartments: d.apartments.map((a) => a.id === aptId ? { ...a, stages: a.stages.map((s) => s.id === stageId ? { ...s, done: !s.done } : s) } : a),
  }));

  const addExpense = (expense) => setData((d) => ({ ...d, expenses: [...d.expenses, expense] }));
  const removeExpense = (id) => setData((d) => ({ ...d, expenses: d.expenses.filter((ex) => ex.id !== id) }));

  const addPayment = (payment) => setData((d) => ({ ...d, payments: [...d.payments, payment] }));
  const removePayment = (id) => setData((d) => ({ ...d, payments: d.payments.filter((p) => p.id !== id) }));

  const updateQuickCalc = (patch) => setData((d) => ({ ...d, quickCalc: { ...d.quickCalc, ...patch } }));
  const addQuickRow = (name) => setData((d) => ({ ...d, quickCalc: { ...d.quickCalc, rows: [...d.quickCalc.rows, { id: uid(), name: name || "", days: 1 }] } }));
  const updateQuickRow = (id, patch) => setData((d) => ({ ...d, quickCalc: { ...d.quickCalc, rows: d.quickCalc.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) } }));
  const removeQuickRow = (id) => setData((d) => ({ ...d, quickCalc: { ...d.quickCalc, rows: d.quickCalc.rows.filter((r) => r.id !== id) } }));

  const todayLogged = loggedDates.includes(todayISO());

  if (!authReady || (session && !loaded)) {
    return <div className="app-root center-loading"><Loader2 className="spin" size={26} /><style>{GLOBAL_CSS}</style></div>;
  }
  if (!session) return <AuthGate />;

  const isEditor = true;
  const displayName = [session.user.user_metadata?.first_name, session.user.user_metadata?.last_name].filter(Boolean).join(" ") || session.user.user_metadata?.login_id || "Foydalanuvchi";
  const initials = ([session.user.user_metadata?.first_name, session.user.user_metadata?.last_name].filter(Boolean).map((n) => n[0]).join("") || displayName.slice(0, 2)).toUpperCase();
  const handleLogout = () => supabase.auth.signOut();

  return (
    <div className="app-root">
      <style>{GLOBAL_CSS}</style>

      <header className="top-bar">
        <div className="top-bar-left">
          <div className="top-icon"><Hammer size={18} /></div>
          <div>
            <div className="top-eyebrow">Remont loyihasi</div>
            <h1 className="top-title">Ish jadvali</h1>
          </div>
        </div>
        <div className="top-bar-right">
          <div className="avatar">{initials}</div>
          <span className="user-name" title={session.user.user_metadata?.login_id || ""}>{displayName}</span>
          <button className="icon-round" onClick={handleLogout} title="Chiqish"><LogOut size={14} /></button>
        </div>
      </header>

      {isEditor && !todayLogged && tab !== "jurnal" && (
        <div className="reminder-banner">
          <Bell size={15} />
          <span>Bugungi kun hali jurnalga kiritilmagan</span>
          <button onClick={() => setTab("jurnal")}>Kiritish</button>
        </div>
      )}
      <div className="save-indicator">{saving ? "saqlanmoqda…" : "hammasi saqlangan"}</div>
      <LiveStats compact />

      <main className="content">
        {tab === "jurnal" && isEditor && (
          <JurnalTab data={data} activeApartments={activeApartments} selectedDate={selectedDate} setSelectedDate={setSelectedDate} draft={draft} setDraftFor={setDraftFor} saveDay={saveDay} loggedDates={loggedDates} />
        )}
        {tab === "hisobot" && (
          <HisobotTab data={data} report={report} workerTotals={workerTotals} activeApartments={activeApartments} addExpense={addExpense} removeExpense={removeExpense} toggleStage={toggleStage} addPayment={addPayment} removePayment={removePayment} isEditor={isEditor} />
        )}
        {tab === "sozlama" && isEditor && (
          <SozlamaTab data={data} addWorker={addWorker} removeWorker={removeWorker} renameWorker={renameWorker} addApartment={addApartment} removeApartment={removeApartment} updateApartment={updateApartment} toggleArchive={toggleArchive} />
        )}
        {tab === "tezkor" && (
          <TezkorTab data={data} isEditor={isEditor} updateQuickCalc={updateQuickCalc} addQuickRow={addQuickRow} updateQuickRow={updateQuickRow} removeQuickRow={removeQuickRow} />
        )}
      </main>

      <BottomNav tab={tab} setTab={setTab} isEditor={isEditor} />
    </div>
  );
}

function BottomNav({ tab, setTab, isEditor }) {
  const items = [
    isEditor && { id: "jurnal", label: "Jurnal", Icon: CalendarDays },
    { id: "hisobot", label: "Hisobot", Icon: Home },
    { id: "tezkor", label: "Tezkor", Icon: Calculator },
    isEditor && { id: "sozlama", label: "Sozlama", Icon: Settings2 },
  ].filter(Boolean);
  return (
    <nav className="bottom-nav">
      {items.map(({ id, label, Icon }) => (
        <button key={id} className={`bn-item ${tab === id ? "bn-active" : ""}`} onClick={() => setTab(id)}>
          <Icon size={18} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function AuthGate() {
  const [mode, setMode] = useState("login");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const submit = async (event) => {
    event.preventDefault(); setError(""); setMessage("");
    const normalized = normalizeLoginId(loginId);
    if (!isValidLoginId(normalized)) { setError("Login ID 3–40 ta kichik harf, raqam, nuqta, tire yoki pastki chiziqdan iborat bo'lsin."); return; }
    if (password.length < 6) { setError("Parol kamida 6 ta belgidan iborat bo'lsin."); return; }
    if (mode === "register" && (!firstName.trim() || !lastName.trim())) { setError("Ism va familiyani kiriting."); return; }
    setBusy(true);
    try {
      if (mode === "login") {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: loginIdToEmail(normalized), password });
        if (authError) throw authError;
      } else {
        const { data: result, error: authError } = await supabase.auth.signUp({ email: loginIdToEmail(normalized), password, options: { data: { login_id: normalized, first_name: firstName.trim(), last_name: lastName.trim() } } });
        if (authError) throw authError;
        if (!result.session) setMessage("Ro'yxatdan o'tish yakunlandi. Agar Supabase email tasdig'ini yoqqan bo'lsa, administrator uni o'chirishi yoki test userni tasdiqlashi kerak.");
      }
    } catch (authError) { setError(authError.message || "Kirishda xatolik yuz berdi."); }
    finally { setBusy(false); }
  };
  return (
    <div className="app-root gate-root"><style>{GLOBAL_CSS}</style><div className="gate-card auth-card">
      <div className="top-icon gate-icon"><Hammer size={22} /></div><h1 className="gate-title">Remont Hisob</h1>
      <p className="gate-sub">{mode === "login" ? "Hisobingizga kiring" : "Yangi foydalanuvchi yarating"}</p>
      <form className="auth-form" onSubmit={submit}>
        {mode === "register" && <><input className="auth-field" placeholder="Ism" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" /><input className="auth-field" placeholder="Familiya" value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" /></>}
        <input className="auth-field" placeholder="Login ID" value={loginId} onChange={(e) => setLoginId(e.target.value)} autoComplete="username" />
        <input className="auth-field" type="password" placeholder="Parol" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} />
        {error && <div className="gate-error">{error}</div>}{message && <div className="auth-message">{message}</div>}
        <button className="btn-primary gate-btn" type="submit" disabled={busy}>{busy ? <Loader2 size={16} className="spin" /> : mode === "login" ? "Kirish" : "Ro'yxatdan o'tish"}</button>
      </form>
      <button className="auth-switch" type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); setMessage(""); }}>{mode === "login" ? "Yangi hisob yaratish" : "Hisobim bor, kirish"}</button>
      <LiveStats />
    </div></div>
  );
}

function LiveStats({ compact = false }) {
  const [registered, setRegistered] = useState(null);
  const [online, setOnline] = useState(1);

  useEffect(() => {
    let alive = true;
    const loadCount = async () => {
      try {
        const { data: count, error } = await supabase.rpc("get_registered_count");
        if (error) throw error;
        if (alive && typeof count === "number") setRegistered(count);
      } catch (error) { console.error("Statistikani yuklashda xatolik", error); }
    };
    loadCount();
    const timer = setInterval(loadCount, 60000);

    const channel = supabase.channel("site-presence", { config: { presence: { key: uid() + uid() } } });
    channel
      .on("presence", { event: "sync" }, () => {
        if (alive) setOnline(Math.max(1, Object.keys(channel.presenceState()).length));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          try { await channel.tr
