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
  editPin: "1234",
};

const STORAGE_KEY = "remont-tracker-v2";
const ROLE_KEY = "remont-tracker-role";

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
  return d;
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
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("hisobot");
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [draft, setDraft] = useState({});
  const [role, setRole] = useState(null);
  const [roleLoaded, setRoleLoaded] = useState(false);
  const remoteApply = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY, true);
        if (res && res.value) setData(normalize(JSON.parse(res.value)));
      } catch (e) {
        // birinchi marta ochilyapti — standart holatdan boshlaymiz
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(ROLE_KEY, false);
        if (res && res.value) setRole(res.value);
      } catch (e) {}
      finally { setRoleLoaded(true); }
    })();
  }, []);

  const chooseRole = async (r) => {
    setRole(r);
    if (r === "editor") setTab("jurnal");
    try { await window.storage.set(ROLE_KEY, r, false); } catch (e) {}
  };
  const switchRole = async () => {
    setRole(null);
    try { await window.storage.delete(ROLE_KEY, false); } catch (e) {}
  };

  useEffect(() => {
    if (!loaded) return;
    if (remoteApply.current) { remoteApply.current = false; return; }
    setSaving(true);
    const t = setTimeout(async () => {
      try { await window.storage.set(STORAGE_KEY, JSON.stringify(data), true); }
      catch (e) { console.error("Saqlashda xatolik", e); }
      finally { setSaving(false); }
    }, 500);
    return () => clearTimeout(t);
  }, [data, loaded]);

  // boshqa telefonlardagi o'zgarishlarni davriy tekshirib turish
  useEffect(() => {
    if (!loaded) return;
    const interval = setInterval(async () => {
      if (saving) return;
      try {
        const res = await window.storage.get(STORAGE_KEY, true);
        if (res && res.value) {
          const currentJSON = JSON.stringify(data);
          if (res.value !== currentJSON) {
            remoteApply.current = true;
            setData(normalize(JSON.parse(res.value)));
          }
        }
      } catch (e) {}
    }, 6000);
    return () => clearInterval(interval);
  }, [loaded, data, saving]);

  useEffect(() => {
    const forDate = data.entries.filter((e) => e.date === selectedDate);
    const next = {};
    data.workers.forEach((w) => {
      const existing = forDate.find((e) => e.workerId === w.id);
      next[w.id] = existing ? { apartmentId: existing.apartmentId, status: existing.status } : { apartmentId: null, status: "full" };
    });
    setDraft(next);
    // eslint-disable-next-line
  }, [selectedDate]);

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
  const setEditPin = (pin) => setData((d) => ({ ...d, editPin: pin }));

  const addPayment = (payment) => setData((d) => ({ ...d, payments: [...d.payments, payment] }));
  const removePayment = (id) => setData((d) => ({ ...d, payments: d.payments.filter((p) => p.id !== id) }));

  const updateQuickCalc = (patch) => setData((d) => ({ ...d, quickCalc: { ...d.quickCalc, ...patch } }));
  const addQuickRow = (name) => setData((d) => ({ ...d, quickCalc: { ...d.quickCalc, rows: [...d.quickCalc.rows, { id: uid(), name: name || "", days: 1 }] } }));
  const updateQuickRow = (id, patch) => setData((d) => ({ ...d, quickCalc: { ...d.quickCalc, rows: d.quickCalc.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) } }));
  const removeQuickRow = (id) => setData((d) => ({ ...d, quickCalc: { ...d.quickCalc, rows: d.quickCalc.rows.filter((r) => r.id !== id) } }));

  const todayLogged = loggedDates.includes(todayISO());

  if (!loaded || !roleLoaded) {
    return <div className="app-root center-loading"><Loader2 className="spin" size={26} /><style>{GLOBAL_CSS}</style></div>;
  }
  if (!role) return <RoleGate data={data} chooseRole={chooseRole} />;

  const isEditor = role === "editor";

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
          <span className={`role-pill ${isEditor ? "role-pill-editor" : "role-pill-viewer"}`}>
            {isEditor ? <Lock size={11} /> : <Eye size={11} />} {isEditor ? "Tahrir" : "Kuzatuv"}
          </span>
          <button className="icon-round" onClick={switchRole} title="Rolni almashtirish"><LogOut size={14} /></button>
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

      <main className="content">
        {tab === "jurnal" && isEditor && (
          <JurnalTab data={data} activeApartments={activeApartments} selectedDate={selectedDate} setSelectedDate={setSelectedDate} draft={draft} setDraftFor={setDraftFor} saveDay={saveDay} loggedDates={loggedDates} />
        )}
        {tab === "hisobot" && (
          <HisobotTab data={data} report={report} workerTotals={workerTotals} activeApartments={activeApartments} addExpense={addExpense} removeExpense={removeExpense} toggleStage={toggleStage} addPayment={addPayment} removePayment={removePayment} isEditor={isEditor} />
        )}
        {tab === "sozlama" && isEditor && (
          <SozlamaTab data={data} addWorker={addWorker} removeWorker={removeWorker} renameWorker={renameWorker} addApartment={addApartment} removeApartment={removeApartment} updateApartment={updateApartment} toggleArchive={toggleArchive} setEditPin={setEditPin} />
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

function RoleGate({ data, chooseRole }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const submit = () => {
    if (pin === data.editPin) chooseRole("editor");
    else setError("PIN noto'g'ri");
  };
  return (
    <div className="app-root gate-root">
      <style>{GLOBAL_CSS}</style>
      <div className="gate-card">
        <div className="top-icon gate-icon"><Hammer size={22} /></div>
        <h1 className="gate-title">Ish jadvali</h1>
        <p className="gate-sub">Ushbu havolani qaysi tarzda ochyapsiz?</p>
        <button className="btn-primary gate-btn" onClick={() => chooseRole("viewer")}>
          <Eye size={16} /> Kuzatuvchi sifatida (faqat ko'rish)
        </button>
        <TickDivider label="yoki" />
        <div className="gate-editor-box">
          <label className="gate-pin-label"><Lock size={13} /> Tahrirlovchi PIN</label>
          <div className="gate-pin-row">
            <input type="password" inputMode="numeric" placeholder="PIN" value={pin} onChange={(e) => { setPin(e.target.value); setError(""); }} />
            <button className="btn-ghost gate-pin-submit" onClick={submit}>Kirish</button>
          </div>
          {error && <div className="gate-error">{error}</div>}
        </div>
      </div>
    </div>
  );
}

function MonthCalendar({ selectedDate, setSelectedDate, loggedDates }) {
  const [viewMonth, setViewMonth] = useState(selectedDate.slice(0, 7));
  const [y, m] = viewMonth.split("-").map(Number);
  const startWeekday = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(y, m, 0).getDate();
  const loggedSet = new Set(loggedDates);
  const cells = [...Array(startWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const changeMonth = (delta) => {
    let nm = m + delta, ny = y;
    if (nm < 1) { nm = 12; ny--; } if (nm > 12) { nm = 1; ny++; }
    setViewMonth(`${ny}-${String(nm).padStart(2, "0")}`);
  };
  return (
    <div className="calendar">
      <div className="calendar-head">
        <button onClick={() => changeMonth(-1)}><ChevronLeft size={16} /></button>
        <span>{MONTHS[m - 1]} {y}</span>
        <button onClick={() => changeMonth(1)}><ChevronRight size={16} /></button>
      </div>
      <div className="calendar-weekdays">{WEEKDAYS.map((d) => <span key={d}>{d}</span>)}</div>
      <div className="calendar-grid">
        {cells.map((d, i) => {
          if (d === null) return <span key={i} className="cal-empty" />;
          const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          return (
            <button key={i} className={`cal-day ${iso === selectedDate ? "cal-sel" : ""} ${iso === todayISO() ? "cal-today" : ""}`} onClick={() => setSelectedDate(iso)}>
              {d}
              {loggedSet.has(iso) && <span className="cal-dot" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function JurnalTab({ data, activeApartments, selectedDate, setSelectedDate, draft, setDraftFor, saveDay, loggedDates }) {
  return (
    <div className="pane">
      <MonthCalendar selectedDate={selectedDate} setSelectedDate={setSelectedDate} loggedDates={loggedDates} />
      <TickDivider label={fmtDate(selectedDate)} />
      <div className="worker-rows">
        {data.workers.map((w) => {
          const v = draft[w.id] || { apartmentId: null, status: "full" };
          return (
            <div className="worker-row" key={w.id}>
              <div className="worker-name">{w.name}</div>
              <div className="worker-controls">
                <select value={v.apartmentId || ""} onChange={(e) => setDraftFor(w.id, { apartmentId: e.target.value || null })}>
                  <option value="">Dam olyapti</option>
                  {activeApartments.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                {v.apartmentId && (
                  <div className="status-toggle">
                    <button className={v.status === "full" ? "active" : ""} onClick={() => setDraftFor(w.id, { status: "full" })}>To'liq</button>
                    <button className={v.status === "half" ? "active" : ""} onClick={() => setDraftFor(w.id, { status: "half" })}>Yarim</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <button className="btn-primary" onClick={saveDay}><Check size={16} /> Kunni saqlash</button>
    </div>
  );
}

function HisobotTab({ data, report, workerTotals, activeApartments, addExpense, removeExpense, toggleStage, addPayment, removePayment, isEditor }) {
  const [showArchived, setShowArchived] = useState(false);
  const [expandedApt, setExpandedApt] = useState(null);
  const archivedCount = data.apartments.length - activeApartments.length;
  const visibleReport = report.filter((r) => showArchived || r.apt.status !== "archived");
  const grandTotal = visibleReport.reduce((s, r) => s + r.apt.budget, 0);

  return (
    <div className="pane">
      <div className="apt-summary-grid">
        {visibleReport.map(({ apt, totalPoints, materialTotal, foodTotal, progressPct }) => (
          <div className="apt-card" key={apt.id}>
            <div className="apt-card-top">
              <div>
                <div className="apt-card-name">{apt.name} {apt.status === "archived" && <span className="archived-tag">arxiv</span>}</div>
                <div className="apt-card-budget">{fmtMoney(apt.budget)}</div>
              </div>
              <ProgressRing pct={progressPct} />
            </div>
            {(materialTotal > 0 || foodTotal > 0) && (
              <div className="apt-card-deductions">
                {materialTotal > 0 && <span><Package size={11} /> −{fmtMoney(materialTotal)}</span>}
                {foodTotal > 0 && <span><UtensilsCrossed size={11} /> −{fmtMoney(foodTotal)}</span>}
              </div>
            )}
            <div className="apt-card-points">{totalPoints > 0 ? `${totalPoints} kun-birlik ishlangan` : "hali ish belgilanmagan"}</div>
            <button className="apt-card-expand" onClick={() => setExpandedApt(expandedApt === apt.id ? null : apt.id)}>
              <ListChecks size={13} /> Ish bosqichlari
            </button>
            {expandedApt === apt.id && (
              <div className="stage-list">
                {apt.stages.map((s) => (
                  <label key={s.id} className={`stage-item ${s.done ? "stage-done" : ""}`}>
                    <input type="checkbox" checked={s.done} disabled={!isEditor} onChange={() => toggleStage(apt.id, s.id)} />
                    {s.name}
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {archivedCount > 0 && (
        <button className="btn-ghost archive-toggle" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? <Archive size={14} /> : <ArchiveRestore size={14} />}
          {showArchived ? "Arxivni yashirish" : `Arxivlanganlarni ko'rsatish (${archivedCount})`}
        </button>
      )}

      <TickDivider label="Ishchilar bo'yicha taqsimot" />

      <div className="report-table">
        <div className="report-head" style={{ "--n": visibleReport.length }}>
          <div className="col-name">Ishchi</div>
          {visibleReport.map((r) => <div className="col-apt" key={r.apt.id}>{r.apt.name}</div>)}
          <div className="col-total">Jami</div>
        </div>
        {data.workers.map((w) => (
          <div className="report-row" key={w.id} style={{ "--n": visibleReport.length }}>
            <div className="col-name">{w.name}</div>
            {visibleReport.map((r) => {
              const hasData = r.points[w.id] || Math.abs(r.earnings[w.id] || 0) > 0.01;
              return (
                <div className="col-apt" key={r.apt.id}>
                  {hasData ? (
                    <>
                      <span className="mono">{fmtMoney(r.earnings[w.id])}</span>
                      <span className="days-sub">{r.points[w.id] ? `${r.points[w.id]} kun` : "xarajat"}</span>
                    </>
                  ) : <span className="dash">—</span>}
                </div>
              );
            })}
            <div className="col-total mono">{fmtMoney(workerTotals[w.id])}</div>
          </div>
        ))}
        <div className="report-row report-foot" style={{ "--n": visibleReport.length }}>
          <div className="col-name">Jami byudjet</div>
          {visibleReport.map((r) => <div className="col-apt mono" key={r.apt.id}>{fmtMoney(r.apt.budget)}</div>)}
          <div className="col-total mono">{fmtMoney(grandTotal)}</div>
        </div>
      </div>

      <TickDivider label="Xarajatlar" />
      {isEditor && <ExpenseForm activeApartments={activeApartments} data={data} addExpense={addExpense} />}
      {data.expenses.length > 0 && (
        <div className="expense-list">
          {data.expenses.map((ex) => {
            const apt = data.apartments.find((a) => a.id === ex.apartmentId);
            const who = ex.category === "material" ? "Material" : (!ex.participantIds || ex.participantIds.length === 0) ? "Hammaga" : ex.participantIds.map((id) => data.workers.find((w) => w.id === id)?.name || "?").join(", ");
            return (
              <div className="expense-row" key={ex.id}>
                <div className={`expense-icon ${ex.category === "material" ? "expense-icon-material" : "expense-icon-food"}`}>
                  {ex.category === "material" ? <Package size={14} /> : <UtensilsCrossed size={14} />}
                </div>
                <div className="expense-info">
                  <div className="expense-name">{ex.name}</div>
                  <div className="expense-meta">{apt ? apt.name : "—"} &middot; {who}</div>
                </div>
                <div className="expense-amount mono">{fmtMoney(ex.amount)}</div>
                {isEditor && <button className="icon-btn danger" onClick={() => removeExpense(ex.id)}><Trash2 size={14} /></button>}
              </div>
            );
          })}
        </div>
      )}

      <TickDivider label="To'lov holati" />
      <PaymentsSection data={data} workerTotals={workerTotals} addPayment={addPayment} removePayment={removePayment} isEditor={isEditor} />
    </div>
  );
}

function ExpenseForm({ data, activeApartments, addExpense }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("ovqat");
  const [apartmentId, setApartmentId] = useState(activeApartments[0]?.id || "");
  const [shared, setShared] = useState(true);
  const [participantIds, setParticipantIds] = useState([]);

  useEffect(() => { if (!apartmentId && activeApartments[0]) setApartmentId(activeApartments[0].id); }, [activeApartments, apartmentId]);

  const toggleParticipant = (id) => setParticipantIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  const submit = () => {
    if (!name.trim() || !Number(amount) || !apartmentId) return;
    addExpense({ id: uid(), apartmentId, name: name.trim(), amount: Number(amount), category, participantIds: category === "material" || shared ? [] : participantIds });
    setName(""); setAmount(""); setShared(true); setParticipantIds([]);
  };

  return (
    <div className="expense-form">
      <div className="who-toggle">
        <button className={category === "ovqat" ? "active" : ""} onClick={() => setCategory("ovqat")}><UtensilsCrossed size={13} /> Ovqat/shirinlik</button>
        <button className={category === "material" ? "active" : ""} onClick={() => setCategory("material")}><Package size={13} /> Material</button>
      </div>
      <div className="expense-form-row">
        <input className="expense-name-input" placeholder={category === "material" ? "Masalan: plitka" : "Masalan: choy-shirinlik"} value={name} onChange={(e) => setName(e.target.value)} />
        <div className="budget-input expense-amount-input">
          <input type="number" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <span>₸</span>
        </div>
      </div>
      <select value={apartmentId} onChange={(e) => setApartmentId(e.target.value)}>
        {activeApartments.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      {category === "ovqat" && (
        <>
          <div className="who-toggle">
            <button className={shared ? "active" : ""} onClick={() => setShared(true)}>Hammaga</button>
            <button className={!shared ? "active" : ""} onClick={() => setShared(false)}>Ba'zilariga</button>
          </div>
          {!shared && (
            <div className="participant-chips">
              {data.workers.map((w) => (
                <button key={w.id} className={`chip ${participantIds.includes(w.id) ? "chip-active" : ""}`} onClick={() => toggleParticipant(w.id)}>{w.name}</button>
              ))}
            </div>
          )}
        </>
      )}
      <button className="btn-ghost" onClick={submit}><Plus size={15} /> Xarajat qo'shish</button>
    </div>
  );
}

function PaymentsSection({ data, workerTotals, addPayment, removePayment, isEditor }) {
  const [amounts, setAmounts] = useState({});
  const paidByWorker = useMemo(() => {
    const m = {};
    data.workers.forEach((w) => (m[w.id] = 0));
    data.payments.forEach((p) => (m[p.workerId] = (m[p.workerId] || 0) + p.amount));
    return m;
  }, [data.payments, data.workers]);

  const pay = (workerId) => {
    const amt = Number(amounts[workerId]);
    if (!amt) return;
    addPayment({ id: uid(), workerId, amount: amt, date: todayISO() });
    setAmounts((a) => ({ ...a, [workerId]: "" }));
  };

  return (
    <div className="payments-section">
      {data.workers.map((w) => {
        const earned = workerTotals[w.id] || 0;
        const paid = paidByWorker[w.id] || 0;
        const owed = earned - paid;
        return (
          <div className="payment-row" key={w.id}>
            <div className="payment-name">{w.name}</div>
            <div className="payment-figures">
              <span className="payment-figure"><span className="payment-label">Hisoblangan</span><span className="mono">{fmtMoney(earned)}</span></span>
              <span className="payment-figure"><span className="payment-label">To'langan</span><span className="mono">{fmtMoney(paid)}</span></span>
              <span className={`payment-figure payment-owed ${owed > 0.5 ? "owed-pending" : "owed-done"}`}><span className="payment-label">Qoldiq</span><span className="mono">{fmtMoney(owed)}</span></span>
            </div>
            {isEditor && owed > 0.5 && (
              <div className="payment-add">
                <input type="number" placeholder="summa" value={amounts[w.id] || ""} onChange={(e) => setAmounts((a) => ({ ...a, [w.id]: e.target.value }))} />
                <button onClick={() => pay(w.id)}><Wallet size={13} /> To'ladim</button>
              </div>
            )}
          </div>
        );
      })}
      {data.payments.length > 0 && (
        <div className="payment-history">
          <div className="payment-history-title">So'nggi to'lovlar</div>
          {[...data.payments].reverse().slice(0, 8).map((p) => {
            const w = data.workers.find((x) => x.id === p.workerId);
            return (
              <div className="payment-hist-row" key={p.id}>
                <span>{w ? w.name : "?"} &middot; {fmtDate(p.date)}</span>
                <span className="mono">{fmtMoney(p.amount)}</span>
                {isEditor && <button className="icon-btn danger" onClick={() => removePayment(p.id)}><Trash2 size={12} /></button>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SozlamaTab({ data, addWorker, removeWorker, renameWorker, addApartment, removeApartment, updateApartment, toggleArchive, setEditPin }) {
  const [pinDraft, setPinDraft] = useState(data.editPin);
  const [pinSaved, setPinSaved] = useState(false);
  const savePin = () => {
    if (!pinDraft.trim()) return;
    setEditPin(pinDraft.trim());
    setPinSaved(true);
    setTimeout(() => setPinSaved(false), 1500);
  };

  return (
    <div className="pane">
      <section>
        <div className="section-head"><Users size={16} /> <span>Ishchilar</span></div>
        <div className="list-edit">
          {data.workers.map((w) => (
            <div className="list-edit-row" key={w.id}>
              <input value={w.name} onChange={(e) => renameWorker(w.id, e.target.value)} />
              <button className="icon-btn danger" onClick={() => removeWorker(w.id)}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
        <button className="btn-ghost" onClick={addWorker}><Plus size={15} /> Ishchi qo'shish</button>
      </section>

      <TickDivider />

      <section>
        <div className="section-head"><Home size={16} /> <span>Kvartiralar</span></div>
        <div className="list-edit">
          {data.apartments.map((a) => (
            <div className="list-edit-row apt-row" key={a.id}>
              <input value={a.name} onChange={(e) => updateApartment(a.id, { name: e.target.value })} />
              <div className="budget-input">
                <input type="number" value={a.budget} onChange={(e) => updateApartment(a.id, { budget: Number(e.target.value) || 0 })} />
                <span>₸</span>
              </div>
              <button className="icon-btn" onClick={() => toggleArchive(a.id)} title={a.status === "archived" ? "Faollashtirish" : "Arxivlash"}>
                {a.status === "archived" ? <ArchiveRestore size={15} /> : <Archive size={15} />}
              </button>
              <button className="icon-btn danger" onClick={() => removeApartment(a.id)}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
        <button className="btn-ghost" onClick={addApartment}><Plus size={15} /> Kvartira qo'shish</button>
      </section>

      <TickDivider />

      <section>
        <div className="section-head"><Lock size={16} /> <span>Tahrirlovchi PIN</span></div>
        <p className="pin-note">Bu PIN'ni bilganlar hamma narsani o'zgartira oladi. Faqat kuzatib borishi kerak bo'lganlarga bermang.</p>
        <div className="list-edit-row">
          <input value={pinDraft} onChange={(e) => setPinDraft(e.target.value)} placeholder="PIN" />
          <button className="btn-ghost pin-save-btn" onClick={savePin}>{pinSaved ? <Check size={15} /> : "Saqlash"}</button>
        </div>
      </section>
    </div>
  );
}

function TezkorTab({ data, isEditor, updateQuickCalc, addQuickRow, updateQuickRow, removeQuickRow }) {
  const { title, totalBudget, rows } = data.quickCalc;
  const totalDays = rows.reduce((s, r) => s + (Number(r.days) || 0), 0);
  const rate = totalDays > 0 ? totalBudget / totalDays : 0;
  const usedNames = new Set(rows.map((r) => r.name));
  const quickAddNames = data.workers.map((w) => w.name).filter((n) => !usedNames.has(n));

  const downloadExcel = () => {
    const aoa = [
      ["Loyiha", title || "Nomsiz loyiha"],
      ["Umumiy summa (₸)", totalBudget],
      ["Jami kun", totalDays],
      ["1 kunlik stavka (₸)", Math.round(rate)],
      [],
      ["Ism", "Ishlagan kuni", "1 kunlik stavka (₸)", "Umumiy puli (₸)"],
      ...rows.map((r) => [r.name || "—", Number(r.days) || 0, Math.round(rate), Math.round((Number(r.days) || 0) * rate)]),
    ];
    const wsData = XLSX.utils.aoa_to_sheet(aoa);
    wsData["!cols"] = [{ wch: 22 }, { wch: 16 }, { wch: 18 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsData, "Hisobot");
    XLSX.writeFile(wb, `${(title || "loyiha-hisobi").replace(/\s+/g, "-")}.xlsx`);
  };

  return (
    <div className="pane">
      <div className="quick-card">
        <div className="section-head"><Calculator size={16} /> <span>Tezkor bo'lish</span></div>
        <p className="pin-note">Bitgan (yoki alohida) loyiha uchun: har kim nechta kun ishlaganini kiriting (0.5 kun ham bo'ladi), summa ishlagan kuniga qarab adolatli bo'linadi. Bu jurnal bilan bog'liq emas — alohida ishlaydi.</p>

        <label className="quick-label">Loyiha nomi (ixtiyoriy)</label>
        <input className="quick-input" disabled={!isEditor} value={title} onChange={(e) => updateQuickCalc({ title: e.target.value })} placeholder="Masalan: Kvartira 3, Chilonzor" />

        <label className="quick-label">Umumiy summa</label>
        <div className="budget-input quick-budget">
          <input type="number" disabled={!isEditor} value={totalBudget || ""} onChange={(e) => updateQuickCalc({ totalBudget: Number(e.target.value) || 0 })} placeholder="0" />
          <span>₸</span>
        </div>
      </div>

      <div className="quick-rows">
        {rows.map((r) => (
          <div className="quick-row" key={r.id}>
            <input className="quick-row-name" disabled={!isEditor} value={r.name} onChange={(e) => updateQuickRow(r.id, { name: e.target.value })} placeholder="Ism" />
            <input className="quick-row-days" type="number" step="0.5" min="0" disabled={!isEditor} value={r.days} onChange={(e) => updateQuickRow(r.id, { days: e.target.value === "" ? "" : Number(e.target.value) })} />
            <span className="quick-row-amount mono">{fmtMoney((Number(r.days) || 0) * rate)}</span>
            {isEditor && <button className="icon-btn danger" onClick={() => removeQuickRow(r.id)}><X size={13} /></button>}
          </div>
        ))}
      </div>

      {isEditor && (
        <>
          {quickAddNames.length > 0 && (
            <div className="participant-chips">
              {quickAddNames.map((n) => (
                <button key={n} className="chip" onClick={() => addQuickRow(n)}>+ {n}</button>
              ))}
            </div>
          )}
          <button className="btn-ghost" onClick={() => addQuickRow("")}><Plus size={15} /> Ishchi qo'shish</button>
        </>
      )}

      {rows.length > 0 && (
        <div className="quick-summary">
          <div><span>Jami kun</span><span className="mono">{totalDays}</span></div>
          <div><span>1 kunlik stavka</span><span className="mono">{fmtMoney(rate)}</span></div>
          <div className="quick-summary-total"><span>Jami taqsimlangan</span><span className="mono">{fmtMoney(totalDays * rate)}</span></div>
        </div>
      )}

      {rows.length > 0 && (
        <button className="btn-primary" onClick={downloadExcel}><Download size={16} /> Excel'ga yuklab olish</button>
      )}
    </div>
  );
}

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600&display=swap');

:root {
  --bg: #F5F6FA;
  --surface: #FFFFFF;
  --surface-2: #EEF0F7;
  --border: rgba(15,23,42,0.08);
  --text: #161A24;
  --text-muted: #6B7280;
  --accent: #0F766E;
  --accent-soft: rgba(15,118,110,0.12);
  --amber: #D97706;
  --amber-soft: rgba(217,119,6,0.14);
  --red: #DC2626;
  --red-soft: rgba(220,38,38,0.08);
}
* { box-sizing: border-box; }

.app-root {
  background: var(--bg);
  min-height: 100vh;
  color: var(--text);
  font-family: 'Inter', sans-serif;
  padding: 16px 14px 96px;
  max-width: 560px;
  margin: 0 auto;
}
.center-loading { display: flex; align-items: center; justify-content: center; }
.spin { animation: spin 1s linear infinite; color: var(--accent); }
@keyframes spin { to { transform: rotate(360deg); } }

.top-bar { display: flex; align-items: center; justify-content: space-between; background: var(--surface); border: 1px solid var(--border); border-radius: 18px; padding: 12px 14px; box-shadow: 0 1px 2px rgba(15,23,42,0.04), 0 8px 20px rgba(15,23,42,0.04); margin-bottom: 10px; }
.top-bar-left { display: flex; align-items: center; gap: 10px; }
.top-icon { width: 38px; height: 38px; border-radius: 12px; background: var(--accent); color: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.top-eyebrow { font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); font-weight: 600; }
.top-title { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 18px; font-weight: 800; margin: 1px 0 0; }
.top-bar-right { display: flex; align-items: center; gap: 6px; }
.role-pill { display: flex; align-items: center; gap: 4px; padding: 5px 10px; border-radius: 20px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; }
.role-pill-editor { background: var(--accent-soft); color: var(--accent); }
.role-pill-viewer { background: var(--surface-2); color: var(--text-muted); }
.icon-round { width: 30px; height: 30px; border-radius: 50%; border: 1px solid var(--border); background: var(--surface); color: var(--text-muted); display: flex; align-items: center; justify-content: center; cursor: pointer; }

.reminder-banner { display: flex; align-items: center; gap: 8px; background: var(--amber-soft); color: #92400E; border: 1px solid rgba(217,119,6,0.25); border-radius: 14px; padding: 10px 12px; font-size: 12.5px; margin-bottom: 10px; }
.reminder-banner button { margin-left: auto; background: var(--amber); color: #fff; border: none; border-radius: 8px; padding: 6px 10px; font-size: 12px; font-weight: 600; cursor: pointer; }
.save-indicator { text-align: right; font-size: 10.5px; color: var(--text-muted); font-family: 'JetBrains Mono', monospace; margin-bottom: 10px; }

.content { display: flex; flex-direction: column; }
.pane { display: flex; flex-direction: column; gap: 14px; }

.tick-divider { display: flex; align-items: center; gap: 8px; margin: 2px 0; }
.tick-line { flex: 1; height: 1px; background: var(--border); }
.tick-label { font-size: 11px; font-weight: 600; color: var(--text-muted); white-space: nowrap; }

/* calendar */
.calendar { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 12px; }
.calendar-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 13px; }
.calendar-head button { background: var(--surface-2); border: none; border-radius: 8px; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--text); }
.calendar-weekdays { display: grid; grid-template-columns: repeat(7,1fr); text-align: center; font-size: 10px; color: var(--text-muted); margin-bottom: 4px; }
.calendar-grid { display: grid; grid-template-columns: repeat(7,1fr); gap: 3px; }
.cal-empty { visibility: hidden; }
.cal-day { position: relative; aspect-ratio: 1; border: none; background: transparent; border-radius: 10px; font-size: 12.5px; color: var(--text); cursor: pointer; font-family: 'JetBrains Mono', monospace; }
.cal-day:hover { background: var(--surface-2); }
.cal-today { font-weight: 700; color: var(--accent); }
.cal-sel { background: var(--accent); color: #fff !important; }
.cal-dot { position: absolute; bottom: 3px; left: 50%; transform: translateX(-50%); width: 4px; height: 4px; border-radius: 50%; background: var(--amber); }
.cal-sel .cal-dot { background: #fff; }

.worker-rows { display: flex; flex-direction: column; gap: 8px; }
.worker-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 10px 12px; }
.worker-name { font-weight: 600; font-size: 13.5px; }
.worker-controls { display: flex; align-items: center; gap: 8px; }
.worker-controls select { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 6px 8px; font-size: 12px; max-width: 118px; }
.status-toggle { display: flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.status-toggle button { background: transparent; color: var(--text-muted); border: none; padding: 6px 9px; font-size: 11px; cursor: pointer; }
.status-toggle button.active { background: var(--accent); color: #fff; font-weight: 600; }

.btn-primary { display: flex; align-items: center; justify-content: center; gap: 7px; background: var(--accent); color: #fff; border: none; border-radius: 14px; padding: 13px; font-weight: 700; font-size: 14px; cursor: pointer; font-family: 'Plus Jakarta Sans', sans-serif; box-shadow: 0 6px 16px rgba(15,118,110,0.25); }
.btn-ghost { display: flex; align-items: center; justify-content: center; gap: 6px; background: var(--surface); border: 1px dashed var(--border); color: var(--text-muted); padding: 10px; border-radius: 12px; font-size: 13px; cursor: pointer; width: 100%; }

.apt-summary-grid { display: flex; flex-direction: column; gap: 10px; }
.apt-card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 14px; box-shadow: 0 1px 2px rgba(15,23,42,0.03); }
.apt-card-top { display: flex; align-items: center; justify-content: space-between; }
.apt-card-name { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 14.5px; display: flex; align-items: center; gap: 6px; }
.archived-tag { font-size: 9px; text-transform: uppercase; background: var(--surface-2); color: var(--text-muted); padding: 2px 6px; border-radius: 6px; }
.apt-card-budget { font-family: 'JetBrains Mono', monospace; font-size: 18px; color: var(--accent); font-weight: 600; margin-top: 3px; }
.apt-card-deductions { display: flex; gap: 12px; font-size: 11px; color: var(--text-muted); margin-top: 8px; }
.apt-card-deductions span { display: flex; align-items: center; gap: 4px; }
.apt-card-points { font-size: 11px; color: var(--text-muted); margin-top: 6px; }
.apt-card-expand { display: flex; align-items: center; gap: 5px; background: none; border: none; color: var(--accent); font-size: 12px; font-weight: 600; padding: 8px 0 0; cursor: pointer; }

.ring { border-radius: 50%; background: conic-gradient(var(--accent) calc(var(--pct)*1%), var(--surface-2) 0); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.ring-inner { width: 72%; height: 72%; border-radius: 50%; background: var(--surface); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; font-family: 'JetBrains Mono', monospace; color: var(--text); }

.stage-list { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; border-top: 1px dashed var(--border); padding-top: 8px; }
.stage-item { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text); cursor: pointer; }
.stage-item.stage-done { color: var(--text-muted); text-decoration: line-through; }
.stage-item input { accent-color: var(--accent); width: 15px; height: 15px; }

.archive-toggle { width: auto; align-self: flex-start; padding: 6px 12px; font-size: 11.5px; }

.report-table { border: 1px solid var(--border); border-radius: 16px; overflow: hidden; background: var(--surface); }
.report-head, .report-row { display: grid; grid-template-columns: 1fr repeat(var(--n, 2), 1fr) 0.9fr; align-items: center; }
.report-head { background: var(--surface-2); font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--text-muted); padding: 9px 10px; font-weight: 600; }
.report-row { padding: 9px 10px; border-top: 1px solid var(--border); font-size: 12px; }
.report-foot { background: var(--surface-2); font-weight: 700; }
.col-name { font-weight: 600; }
.col-apt { display: flex; flex-direction: column; align-items: flex-end; padding-right: 6px; }
.col-total { text-align: right; color: var(--accent); font-weight: 700; }
.mono { font-family: 'JetBrains Mono', monospace; }
.days-sub { font-size: 9px; color: var(--text-muted); }
.dash { color: var(--border); text-align: right; display: block; }

.section-head { display: flex; align-items: center; gap: 7px; font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 14px; margin-bottom: 10px; color: var(--text); }
.list-edit { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.list-edit-row { display: flex; align-items: center; gap: 8px; }
.list-edit-row input[type=text], .list-edit-row input:not([type]) { flex: 1; background: var(--surface); border: 1px solid var(--border); color: var(--text); padding: 9px 10px; border-radius: 10px; font-size: 13px; }
.apt-row .budget-input { display: flex; align-items: center; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 0 8px; width: 112px; }
.apt-row .budget-input span { color: var(--text-muted); font-size: 12px; }
.apt-row .budget-input input { background: transparent; border: none; color: var(--text); padding: 8px 4px; width: 100%; font-family: 'JetBrains Mono', monospace; font-size: 13px; }
.icon-btn { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 8px; color: var(--text-muted); cursor: pointer; flex-shrink: 0; }
.icon-btn.danger:hover { border-color: var(--red); color: var(--red); }
.pin-note { font-size: 11.5px; color: var(--text-muted); margin: 0 0 10px; }
.pin-save-btn { width: auto; padding: 9px 16px; }

.expense-form { display: flex; flex-direction: column; gap: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 12px; }
.expense-form-row { display: flex; gap: 8px; }
.expense-name-input { flex: 1; background: var(--surface-2); border: 1px solid var(--border); color: var(--text); padding: 9px 10px; border-radius: 10px; font-size: 13px; }
.expense-amount-input { width: 110px; }
.expense-form select { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 10px; padding: 9px 10px; font-size: 13px; width: 100%; }
.who-toggle { display: flex; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.who-toggle button { flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px; background: transparent; color: var(--text-muted); border: none; padding: 8px; font-size: 12px; cursor: pointer; }
.who-toggle button.active { background: var(--accent); color: #fff; font-weight: 600; }
.participant-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { background: var(--surface-2); border: 1px solid var(--border); color: var(--text-muted); padding: 6px 11px; border-radius: 20px; font-size: 11px; cursor: pointer; }
.chip-active { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }

.expense-list { display: flex; flex-direction: column; gap: 6px; }
.expense-row { display: flex; align-items: center; gap: 9px; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 9px 10px; }
.expense-icon { width: 28px; height: 28px; border-radius: 9px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.expense-icon-material { background: var(--amber-soft); color: var(--amber); }
.expense-icon-food { background: var(--accent-soft); color: var(--accent); }
.expense-info { flex: 1; min-width: 0; }
.expense-name { font-size: 13px; font-weight: 600; }
.expense-meta { font-size: 11px; color: var(--text-muted); }
.expense-amount { color: var(--text); font-size: 13px; white-space: nowrap; font-weight: 600; }

.payments-section { display: flex; flex-direction: column; gap: 8px; }
.payment-row { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 11px 12px; }
.payment-name { font-weight: 600; font-size: 13.5px; margin-bottom: 6px; }
.payment-figures { display: flex; gap: 14px; }
.payment-figure { display: flex; flex-direction: column; gap: 2px; }
.payment-label { font-size: 9.5px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.02em; }
.payment-owed.owed-pending .mono { color: var(--red); }
.payment-owed.owed-done .mono { color: var(--accent); }
.payment-add { display: flex; gap: 6px; margin-top: 8px; }
.payment-add input { flex: 1; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 7px 9px; font-size: 12px; }
.payment-add button { display: flex; align-items: center; gap: 5px; background: var(--accent); color: #fff; border: none; border-radius: 8px; padding: 7px 11px; font-size: 12px; font-weight: 600; cursor: pointer; }
.payment-history { margin-top: 4px; border-top: 1px dashed var(--border); padding-top: 8px; }
.payment-history-title { font-size: 11px; color: var(--text-muted); font-weight: 600; margin-bottom: 6px; }
.payment-hist-row { display: flex; align-items: center; gap: 8px; font-size: 11.5px; padding: 4px 0; }
.payment-hist-row span:first-child { flex: 1; color: var(--text-muted); }

.bottom-nav { position: fixed; bottom: 14px; left: 50%; transform: translateX(-50%); width: calc(100% - 28px); max-width: 532px; background: var(--surface); border: 1px solid var(--border); border-radius: 20px; display: flex; box-shadow: 0 10px 30px rgba(15,23,42,0.12); overflow: hidden; }
.bn-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; background: transparent; border: none; padding: 10px 4px; color: var(--text-muted); font-size: 10.5px; cursor: pointer; }
.bn-active { color: var(--accent); font-weight: 700; }

.gate-root { display: flex; align-items: center; justify-content: center; }
.gate-card { max-width: 340px; width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 20px; padding: 26px 20px; text-align: center; box-shadow: 0 10px 30px rgba(15,23,42,0.08); }
.gate-icon { margin: 0 auto 12px; }
.gate-title { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 20px; margin: 0; font-weight: 800; }
.gate-sub { font-size: 12px; color: var(--text-muted); margin: 8px 0 16px; }
.gate-btn { width: 100%; margin-bottom: 4px; }
.gate-editor-box { text-align: left; margin-top: 6px; }
.gate-pin-label { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-muted); margin-bottom: 6px; }
.gate-pin-row { display: flex; gap: 8px; }
.gate-pin-row input { flex: 1; background: var(--surface-2); border: 1px solid var(--border); color: var(--text); padding: 9px 10px; border-radius: 10px; font-family: 'JetBrains Mono', monospace; letter-spacing: 0.2em; }
.gate-pin-submit { width: auto; padding: 9px 14px; }
.gate-error { color: var(--red); font-size: 11px; margin-top: 6px; }

@media (max-width: 380px) {
  .worker-controls select { max-width: 88px; }
  .payment-figures { flex-wrap: wrap; gap: 8px 14px; }
}

.quick-card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 14px; display: flex; flex-direction: column; gap: 8px; }
.quick-label { font-size: 11px; color: var(--text-muted); font-weight: 600; margin-top: 4px; }
.quick-input { background: var(--surface-2); border: 1px solid var(--border); color: var(--text); padding: 9px 10px; border-radius: 10px; font-size: 13px; }
.quick-budget { width: 100%; }
.quick-budget input { flex: 1; }
.quick-rows { display: flex; flex-direction: column; gap: 8px; }
.quick-row { display: flex; align-items: center; gap: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 9px 10px; }
.quick-row-name { flex: 1; min-width: 0; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 7px 9px; font-size: 12.5px; }
.quick-row-days { width: 56px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 7px 6px; font-size: 12.5px; text-align: center; }
.quick-row-amount { width: 92px; text-align: right; font-size: 12.5px; font-weight: 600; color: var(--accent); }
.quick-summary { background: var(--accent-soft); border: 1px solid rgba(15,118,110,0.2); border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 6px; }
.quick-summary div { display: flex; justify-content: space-between; font-size: 12.5px; color: var(--text); }
.quick-summary-total { font-weight: 700; border-top: 1px dashed rgba(15,118,110,0.3); padding-top: 6px; margin-top: 2px; }
`;
