import { useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck, BookOpen,
  Check, ChevronRight, ClipboardList, Clock3, Copy, Eye, FileText,
  Heart, Home, KeyRound, LogOut, Moon, Plus, Search, Send,
  Settings2, ShieldCheck, Sparkles, Sun, Users, UserRound, WandSparkles, X
} from "lucide-react";
import { api, jsonBody } from "./api.js";
import { localizePage } from "./i18n.js";

const initialDraft = () => ({
  title: "", description: "", groupId: "",
  questions: [{ type: "yes_no", prompt: "", options: ["Ha", "Yo‘q"], correctOptionIndex: null }]
});

const roleLabel = role => ({ admin: "Admin", creator: "Creator", tester: "Tester", user: "Tester" })[role] || "Tester";
const dateLabel = (value, language = document.documentElement.lang || "uz") => value ? new Intl.DateTimeFormat(({ uz: "uz-UZ", ru: "ru-RU", en: "en-US" })[language] || "uz-UZ", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) : "—";
const dateTimeLabel = (value, language = document.documentElement.lang || "uz") => value ? new Intl.DateTimeFormat(({ uz: "uz-UZ", ru: "ru-RU", en: "en-US" })[language] || "uz-UZ", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";

function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState("home");
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ username: "", firstName: "", lastName: "", gender: "female", password: "", inviteCode: "" });
  const [groups, setGroups] = useState([]);
  const [quizzes, setQuizzes] = useState([]);
  const [overview, setOverview] = useState({ group_count: 0, client_count: 0, quiz_count: 0, response_count: 0 });
  const [adminUsers, setAdminUsers] = useState([]);
  const [groupMembers, setGroupMembers] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedQuiz, setSelectedQuiz] = useState(null);
  const [results, setResults] = useState(null);
  const [myResults, setMyResults] = useState([]);
  const [myResultsLoading, setMyResultsLoading] = useState(false);
  const [reflectionBusyId, setReflectionBusyId] = useState(null);
  const [answers, setAnswers] = useState({});
  const [aiConsent, setAiConsent] = useState(false);
  const [attempt, setAttempt] = useState(null);
  const [draft, setDraft] = useState(initialDraft);
  const [aiTopic, setAiTopic] = useState("");
  const [aiCount, setAiCount] = useState(5);
  const [aiProvider, setAiProvider] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [groupForm, setGroupForm] = useState({ name: "", description: "", genderRule: "all" });
  const [memberForm, setMemberForm] = useState({ username: "", role: "tester" });
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [confirmDialog, setConfirmDialog] = useState(null);

  const isAdmin = user?.role === "admin";
  const canCreate = ["admin", "creator"].includes(user?.role);
  const selectedGroup = groups.find(group => group.id === selectedGroupId) || null;
  const authorGroups = groups.filter(group => group.my_role === "admin" || group.my_role === "creator");
  const visibleQuizzes = useMemo(() => quizzes.filter(quiz =>
    !searchTerm.trim() || `${quiz.title} ${quiz.description} ${quiz.group_name || ""}`.toLocaleLowerCase("uz-UZ").includes(searchTerm.trim().toLocaleLowerCase("uz-UZ"))
  ), [quizzes, searchTerm]);

  function announce(message) {
    setNotice(message);
    window.clearTimeout(announce.timer);
    announce.timer = window.setTimeout(() => setNotice(""), 5000);
  }

  async function generateReflection(attemptId) {
    const consent = await askToConfirm({ title: "AI tavsifi yaratilsinmi?", message: "Rozilik bersangiz, faqat ushbu testdagi savol va javoblar AI tahliliga yuboriladi. Ism va akkaunt ma’lumotlari yuborilmaydi. AI tavsifi tashxis emas.", confirmLabel: "Roziman, tavsif yaratish" });
    if (!consent) return;
    setReflectionBusyId(attemptId);
    try {
      const { attempt } = await api(`/my/results/${attemptId}/ai-reflection`, { method: "POST", body: jsonBody({ consent: true }) });
      setMyResults(current => current.map(item => item.id === attemptId ? { ...item, ...attempt } : item));
      announce(attempt.ai_reflection ? "AI tavsifi tayyor." : "AI tavsifi yaratilmadi. Javoblar saqlangan; AI xizmati sozlamasini tekshiring.");
    } catch (error) { announce(error.message); }
    finally { setReflectionBusyId(null); }
  }

  function askToConfirm({ title, message, confirmLabel = "Tasdiqlash", danger = false }) {
    return new Promise(resolve => setConfirmDialog({ title, message, confirmLabel, danger, resolve }));
  }

  function resolveConfirm(answer) {
    const dialog = confirmDialog;
    setConfirmDialog(null);
    dialog?.resolve(answer);
  }

  async function loadWorkspace() {
    const [groupData, quizData, overviewData] = await Promise.all([
      api("/groups"), api("/quizzes"), api("/overview")
    ]);
    setGroups(groupData.groups);
    setQuizzes(quizData.quizzes);
    setOverview(overviewData.overview);
    setSelectedGroupId(current => groupData.groups.some(group => group.id === current) ? current : groupData.groups[0]?.id || "");
  }

  useEffect(() => {
    api("/auth/me").then(({ user: currentUser }) => setUser(currentUser)).catch(() => {}).finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!user) {
      document.documentElement.dataset.theme = "light";
      document.documentElement.dataset.textSize = "medium";
      document.documentElement.lang = "uz";
      localizePage(document.body, "uz");
      return;
    }
    document.documentElement.dataset.theme = user.theme || "light";
    document.documentElement.dataset.textSize = user.textSize || "medium";
    document.documentElement.lang = user.language || "uz";
    localizePage(document.body, user.language || "uz");
    const observer = new MutationObserver(records => records.forEach(record => {
      if (record.type === "characterData") localizePage(record.target.parentElement, user.language || "uz");
      for (const node of record.addedNodes || []) {
        if (node.nodeType === Node.ELEMENT_NODE) localizePage(node, user.language || "uz");
        else if (node.nodeType === Node.TEXT_NODE && node.parentElement) localizePage(node.parentElement, user.language || "uz");
      }
    }));
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    loadWorkspace().catch(error => announce(error.message));
    return () => observer.disconnect();
  }, [user?.id, user?.theme, user?.language, user?.textSize]);

  useEffect(() => {
    if (page === "groups" && isAdmin && selectedGroupId) {
      api(`/groups/${selectedGroupId}/members`).then(({ members }) => setGroupMembers(members)).catch(error => announce(error.message));
    }
  }, [page, isAdmin, selectedGroupId]);

  useEffect(() => {
    if (page === "members" && isAdmin) {
      api("/admin/users").then(({ users }) => setAdminUsers(users)).catch(error => announce(error.message));
    }
  }, [page, isAdmin]);

  useEffect(() => {
    if (page !== "my-results" || !user) return;
    let active = true;
    setMyResultsLoading(true);
    api("/my/results").then(({ results: items }) => { if (active) setMyResults(items); })
      .catch(error => { if (active) announce(error.message); })
      .finally(() => { if (active) setMyResultsLoading(false); });
    return () => { active = false; };
  }, [page, user?.id]);

  async function submitAuth(event) {
    event.preventDefault();
    setAuthBusy(true);
    try {
      const path = authMode === "register" ? "/auth/register" : "/auth/login";
      const payload = await api(path, { method: "POST", body: jsonBody(authForm) });
      setUser(payload.user);
      setPage("home");
      setAuthForm({ username: "", firstName: "", lastName: "", gender: "female", password: "", inviteCode: "" });
    } catch (error) { announce(error.message); }
    finally { setAuthBusy(false); }
  }

  async function signOut() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    setGroups([]);
    setQuizzes([]);
    setMyResults([]);
    setPage("home");
  }

  async function openQuiz(quiz) {
    setBusy(true);
    try {
      const data = await api(`/quizzes/${quiz.id}`);
      setSelectedQuiz(data);
      setAnswers({});
      setAiConsent(false);
      setAttempt(null);
      setPage("play");
    } catch (error) { announce(error.message); }
    finally { setBusy(false); }
  }

  async function openResults(quiz) {
    setBusy(true);
    try {
      const data = await api(`/quizzes/${quiz.id}/results`);
      setResults(data);
      setPage("results");
    } catch (error) { announce(error.message); }
    finally { setBusy(false); }
  }

  async function createGroup(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const { group } = await api("/groups", { method: "POST", body: jsonBody(groupForm) });
      await loadWorkspace();
      setSelectedGroupId(group.id);
      setGroupForm({ name: "", description: "", genderRule: "all" });
      announce("Guruh yaratildi. Taklif kodini mijozlar bilan ulashing.");
    } catch (error) { announce(error.message); }
    finally { setBusy(false); }
  }

  async function saveGroup(event) {
    event.preventDefault();
    if (!selectedGroup) return;
    setBusy(true);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const { group } = await api(`/groups/${selectedGroup.id}`, {
        method: "PATCH",
        body: jsonBody({ name: data.get("name"), description: data.get("description"), genderRule: data.get("genderRule"), rotateInvite: data.get("rotateInvite") === "on" })
      });
      setGroups(current => current.map(item => item.id === group.id ? { ...item, ...group } : item));
      announce("Guruh sozlamalari saqlandi.");
    } catch (error) { announce(error.message); }
    finally { setBusy(false); }
  }

  async function addMember(event) {
    event.preventDefault();
    if (!selectedGroup) return;
    setBusy(true);
    try {
      await api(`/groups/${selectedGroup.id}/members`, { method: "POST", body: jsonBody(memberForm) });
      const { members } = await api(`/groups/${selectedGroup.id}/members`);
      setGroupMembers(members);
      setMemberForm({ username: "", role: "tester" });
      await loadWorkspace();
      announce(memberForm.role === "creator" ? "Foydalanuvchiga Creator roli berildi." : "Foydalanuvchi guruhga qo‘shildi.");
    } catch (error) { announce(error.message); }
    finally { setBusy(false); }
  }

  async function removeMember(member) {
    if (!selectedGroup) return;
    try {
      await api(`/groups/${selectedGroup.id}/members/${member.id}`, { method: "DELETE" });
      setGroupMembers(current => current.filter(item => item.id !== member.id));
      await loadWorkspace();
      announce(`${member.username} guruhdan olib tashlandi.`);
    } catch (error) { announce(error.message); }
  }

  async function joinGroup(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    try {
      await api("/groups/join", { method: "POST", body: jsonBody({ inviteCode: data.get("inviteCode") }) });
      await loadWorkspace();
      form.reset();
      announce("Guruhga qo‘shildingiz.");
    } catch (error) { announce(error.message); }
    finally { setBusy(false); }
  }

  async function copyInvite(code) {
    try {
      await navigator.clipboard.writeText(code);
      announce("Taklif kodi nusxalandi.");
    } catch { announce(`Taklif kodi: ${code}`); }
  }

  async function generateWithAi() {
    setBusy(true);
    try {
      const payload = await api("/ai/questions", { method: "POST", body: jsonBody({ topic: aiTopic, count: Number(aiCount), groupId: draft.groupId }) });
      setDraft(current => ({ ...current, title: current.title || payload.title, description: current.description || payload.description, questions: payload.questions.map(question => ({ ...question, correctOptionIndex: question.correctOptionIndex ?? null })) }));
      setAiProvider(payload.provider);
      announce(payload.provider === "ai" ? "AI savollar tayyor. Nashr qilishdan oldin javoblarni ko‘rib chiqing." : "AI kaliti ulanmagan: hozircha boshlang‘ich savollar yaratildi.");
    } catch (error) { announce(error.message); }
    finally { setBusy(false); }
  }

  function updateQuestion(index, changes) {
    setDraft(current => ({ ...current, questions: current.questions.map((question, i) => i === index ? { ...question, ...changes } : question) }));
  }

  async function publishQuiz(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api("/quizzes", { method: "POST", body: jsonBody(draft) });
      await loadWorkspace();
      setDraft(initialDraft());
      setAiProvider("");
      setPage("tests");
      announce("Test guruhga joylandi.");
    } catch (error) { announce(error.message); }
    finally { setBusy(false); }
  }

  async function submitAttempt(event) {
    event.preventDefault();
    if (!selectedQuiz) return;
    setBusy(true);
    try {
      const payload = await api(`/quizzes/${selectedQuiz.quiz.id}/attempts`, {
        method: "POST",
        body: jsonBody({ aiConsent, answers: selectedQuiz.questions.map(question => ({
          questionId: question.id,
          selectedOptionIndex: answers[question.id],
          text: answers[question.id]
        })) })
      });
      setAttempt(payload.attempt);
      await loadWorkspace();
      setPage("my-results");
      announce(payload.attempt.ai_reflection ? "Javoblaringiz saqlandi. AI mulohazasi Natijalar bo‘limida tayyor." : aiConsent ? "Javoblaringiz saqlandi. AI mulohazasi tayyor bo‘lmadi; psixologingiz javoblarni ko‘ra oladi." : "Javoblaringiz saqlandi. AI tahliliga rozilik berilmadi; javoblarni faqat psixologingiz ko‘radi.");
    } catch (error) { announce(error.message); }
    finally { setBusy(false); }
  }

  async function saveSettings(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const { user: updated } = await api("/auth/settings", { method: "PATCH", body: jsonBody(settingsDraft) });
      setUser(updated);
      setSettingsDraft(updated);
      announce("Profil sozlamalari saqlandi.");
    } catch (error) { announce(error.message); }
    finally { setBusy(false); }
  }

  async function moderate(id, action, values = {}) {
    try {
      if (action === "delete" && !await askToConfirm({ title: "Hisobni o‘chirilsinmi?", message: "Hisob va unga tegishli guruhlar, testlar hamda javoblar butunlay o‘chadi. Bu amalni qaytarib bo‘lmaydi.", confirmLabel: "Hisobni o‘chirish", danger: true })) return;
      if (action === "deleteQuiz") {
        if (!await askToConfirm({ title: "Testni o‘chirasizmi?", message: "Test va unga yuborilgan javoblar butunlay o‘chadi. Bu amalni qaytarib bo‘lmaydi.", confirmLabel: "Testni o‘chirish", danger: true })) return;
        await api(`/quizzes/${id}`, { method: "DELETE" });
        await loadWorkspace();
        announce("Test o‘chirildi.");
        return;
      }
      const method = action === "delete" ? "DELETE" : "PATCH";
      await api(`/admin/users/${id}`, { method, ...(method === "PATCH" ? { body: jsonBody({ action, ...values }) } : {}) });
      const { users } = await api("/admin/users");
      setAdminUsers(users);
      announce(({ warn: "Ogohlantirish qo‘shildi.", ban: "Hisob bloklandi.", suspend: "Hisob vaqtincha to‘xtatildi.", role: "Foydalanuvchi roli yangilandi.", delete: "Hisob o‘chirildi.", unban: "Hisob qayta faollashtirildi." })[action]);
    } catch (error) { announce(error.message); }
  }

  function startBuilder() {
    setDraft({ ...initialDraft(), groupId: authorGroups[0]?.id || "" });
    setPage("builder");
  }

  if (!ready) return <div className="loading-screen"><div className="brand-symbol">T</div><span>TestStudio yuklanmoqda…</span></div>;
  if (!user) return <AuthScreen mode={authMode} setMode={setAuthMode} form={authForm} setForm={setAuthForm} onSubmit={submitAuth} busy={authBusy} notice={notice} />;

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <a className="brand" href="#home" onClick={event => { event.preventDefault(); setPage("home"); }}>
          <span className="brand-symbol">T</span><span className="brand-word">teststudio<span>amaliyot</span></span>
        </a>
        <div className="sidebar-practice"><span className="practice-avatar"><Heart size={17} fill="currentColor" /></span><span><strong>Psixolog amaliyoti</strong><small>{isAdmin ? "Boshqaruv paneli" : roleLabel(user.role) + " kabineti"}</small></span></div>
        <span className="sidebar-label">ISH MAYDONI</span>
        <nav className="side-nav" aria-label="Asosiy navigatsiya">
          <SideNav active={page === "home"} icon={<Home size={18} />} onClick={() => setPage("home")}>Umumiy ko‘rinish</SideNav>
          <SideNav active={page === "groups"} icon={<Users size={18} />} onClick={() => setPage("groups")}>Guruhlar</SideNav>
          <SideNav active={page === "tests" || page === "play" || page === "results"} icon={<ClipboardList size={18} />} onClick={() => setPage("tests")}>Testlar</SideNav>
          <SideNav active={page === "my-results"} icon={<Clock3 size={18} />} onClick={() => setPage("my-results")}>Natijalar</SideNav>
          {isAdmin && <SideNav active={page === "members"} icon={<UserRound size={18} />} onClick={() => setPage("members")}>Ishtirokchilar</SideNav>}
          {canCreate && <SideNav active={page === "builder"} icon={<Plus size={18} />} onClick={startBuilder}>Test yaratish</SideNav>}
        </nav>
        <div className="sidebar-bottom">
          <button className={`side-nav-button ${page === "settings" ? "active" : ""}`} onClick={() => { setSettingsDraft({ theme: user.theme || "light", language: user.language || "uz", textSize: user.textSize || "medium", gender: user.gender || "female", avatar: user.avatar || (user.gender === "male" ? "man" : "woman") }); setPage("settings"); }}><Settings2 size={18} />Sozlamalar</button>
          <div className="sidebar-profile"><Avatar value={user.avatar} gender={user.gender} /><span><strong>{user.firstName || user.username} {user.lastName}</strong><small>{roleLabel(user.role)}</small></span><button className="icon-button" onClick={signOut} aria-label="Chiqish" title="Hisobdan chiqish"><LogOut size={16} /></button></div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb"><span>TestStudio</span><ChevronRight size={14} /><strong>{pageTitle(page)}</strong></div>
          <div className="topbar-actions">
            {groups.length > 0 && <label className="group-switcher"><Users size={15} /><select value={selectedGroupId} onChange={event => setSelectedGroupId(event.target.value)} aria-label="Faol guruh">{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select><ChevronRight size={14} /></label>}
            <span className="topbar-divider" />
            <Avatar value={user.avatar} gender={user.gender} />
            <span className="topbar-user">{user.firstName || user.username}</span>
          </div>
        </header>

        {notice && <div className="toast" role="status"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Yopish"><X size={16} /></button></div>}

        <main className="main-content">
          {page === "home" && <Dashboard user={user} groups={groups} quizzes={quizzes} overview={overview} onNavigate={setPage} onCreate={startBuilder} onOpenQuiz={openQuiz} />}
          {page === "groups" && <GroupsPage user={user} groups={groups} selectedGroup={selectedGroup} selectedGroupId={selectedGroupId} setSelectedGroupId={setSelectedGroupId} members={groupMembers} groupForm={groupForm} setGroupForm={setGroupForm} onCreate={createGroup} onSave={saveGroup} memberForm={memberForm} setMemberForm={setMemberForm} onAddMember={addMember} onRemoveMember={removeMember} onJoin={joinGroup} onCopy={copyInvite} busy={busy} />}
          {page === "tests" && <TestsPage user={user} quizzes={visibleQuizzes} searchTerm={searchTerm} setSearchTerm={setSearchTerm} onCreate={startBuilder} onOpen={openQuiz} onResults={openResults} onDelete={moderate} busy={busy} />}
          {page === "members" && <MembersPage users={adminUsers} groups={groups} onManageGroups={() => setPage("groups")} onModerate={moderate} />}
          {page === "my-results" && <MyResultsPage results={myResults} loading={myResultsLoading} onGenerate={generateReflection} reflectionBusyId={reflectionBusyId} />}
          {page === "builder" && <BuilderPage user={user} draft={draft} setDraft={setDraft} groups={authorGroups} aiTopic={aiTopic} setAiTopic={setAiTopic} aiCount={aiCount} setAiCount={setAiCount} aiProvider={aiProvider} busy={busy} onAi={generateWithAi} onPublish={publishQuiz} onBack={() => setPage("tests")} onManageGroups={() => setPage("groups")} updateQuestion={updateQuestion} />}
          {page === "play" && selectedQuiz && <PlayPage data={selectedQuiz} answers={answers} setAnswers={setAnswers} aiConsent={aiConsent} setAiConsent={setAiConsent} attempt={attempt} busy={busy} onSubmit={submitAttempt} onBack={() => setPage("tests")} />}
          {page === "results" && results && <ResultsPage data={results} onBack={() => setPage("tests")} />}
          {page === "settings" && settingsDraft && <SettingsPage user={user} draft={settingsDraft} setDraft={setSettingsDraft} onSave={saveSettings} busy={busy} />}
        </main>
      </div>
      {confirmDialog && <ConfirmDialog dialog={confirmDialog} onResolve={resolveConfirm} />}
    </div>
  );
}

function pageTitle(page) {
  return ({ home: "Umumiy ko‘rinish", groups: "Guruhlar", tests: "Testlar", "my-results": "Natijalar", members: "Ishtirokchilar", builder: "Test yaratish", play: "Test topshirish", results: "Javoblar", settings: "Sozlamalar" })[page] || "Umumiy ko‘rinish";
}

function Avatar({ value, gender = "female", className = "avatar" }) {
  const icon = ["woman", "girl", "woman-sage", "woman-rose", "man", "boy", "man-blue", "man-olive"].includes(value) ? value : gender === "male" ? "man" : "woman";
  return <span className={`${className} avatar-illustration`}><img src={`/avatars/${icon}.svg`} alt="" /></span>;
}

function SideNav({ active, icon, onClick, children }) {
  return <button className={`side-nav-button ${active ? "active" : ""}`} onClick={onClick} title={children} aria-label={children}>{icon}<span>{children}</span>{active && <span className="nav-indicator" />}</button>;
}

function ConfirmDialog({ dialog, onResolve }) {
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape") onResolve(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onResolve]);

  return <div className="site-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onResolve(false); }}><section className="site-dialog" role="alertdialog" aria-modal="true" aria-labelledby="site-dialog-title" aria-describedby="site-dialog-message"><span className={`site-dialog-mark ${dialog.danger ? "danger" : ""}`}><ShieldCheck size={21} /></span><h2 id="site-dialog-title">{dialog.title}</h2><p id="site-dialog-message">{dialog.message}</p><div className="site-dialog-actions"><button type="button" className="button button-outline" onClick={() => onResolve(false)}>Bekor qilish</button><button type="button" autoFocus className={`button ${dialog.danger ? "button-danger" : "button-primary"}`} onClick={() => onResolve(true)}>{dialog.confirmLabel}</button></div></section></div>;
}

function AuthScreen({ mode, setMode, form, setForm, onSubmit, busy, notice }) {
  const registering = mode === "register";
  return (
    <main className="auth-screen">
      <section className="auth-visual">
        <a className="brand auth-brand" href="/"><span className="brand-symbol">T</span><span className="brand-word">teststudio<span>amaliyot</span></span></a>
        <div className="auth-visual-copy"><span className="eyebrow"><Heart size={14} /> PSIXOLOG AMALIYOTI UCHUN</span><h1>Yaxshiroq<br /><em>tushunishdan</em><br />boshlanadi.</h1><p>Guruhlar, mulohaza testlari va mijozlar javoblari bir joyda — tinch va ishonchli muhitda.</p></div>
        <div className="auth-visual-footer"><span>01 — Tinglang</span><span>02 — Anglang</span><span>03 — Birga o‘sing</span></div>
        <span className="auth-orbit orbit-one" /><span className="auth-orbit orbit-two" />
      </section>
      <section className="auth-panel"><form className="auth-card" onSubmit={onSubmit}>
        <span className="eyebrow">{registering ? "YANGI HISOB" : "XUSH KELIBSIZ"}</span>
        <h2>{registering ? "Hisob yarating" : "Hisobingizga kiring"}</h2>
        <p className="auth-lead">{registering ? "Ismingiz va parolingiz bilan boshlang." : "Amaliyot kabinetingizni davom ettiring."}</p>
        {registering && <div className="auth-name-row"><label>Ism<input autoComplete="given-name" minLength="2" maxLength="60" value={form.firstName} onChange={event => setForm({ ...form, firstName: event.target.value })} placeholder="Ismingiz" required /></label><label>Familiya<input autoComplete="family-name" minLength="2" maxLength="60" value={form.lastName} onChange={event => setForm({ ...form, lastName: event.target.value })} placeholder="Familiyangiz" required /></label></div>}
        <label>{registering ? "Foydalanuvchi nomi" : "Ism yoki foydalanuvchi nomi"}<input autoComplete="username" minLength="2" maxLength="32" value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} placeholder={registering ? "Kirish uchun nom" : "Foydalanuvchi nomi"} required /></label>
        {registering && <label>Jins<select value={form.gender} onChange={event => setForm({ ...form, gender: event.target.value })}><option value="female">Ayol</option><option value="male">Erkak</option></select></label>}
        <label>Parol<input autoComplete={registering ? "new-password" : "current-password"} type="password" minLength={registering ? 8 : 1} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} placeholder={registering ? "Kamida 8 ta belgi" : "Parolingiz"} required /></label>
        {registering && <label>Guruh taklif kodi <span className="optional-label">ixtiyoriy</span><input autoComplete="off" maxLength="32" value={form.inviteCode} onChange={event => setForm({ ...form, inviteCode: event.target.value.toUpperCase() })} placeholder="Masalan: 9FA2C61E88B4" /></label>}
        {notice && <p className="form-error" role="alert">{notice}</p>}
        <button className="button button-primary full-button" disabled={busy}>{busy ? "Kuting…" : registering ? "Hisob yaratish" : "Kirish"}<ArrowRight size={17} /></button>
        <button type="button" className="auth-toggle" onClick={() => setMode(registering ? "login" : "register")}>{registering ? "Hisobingiz bormi? Kirish" : "Yangi foydalanuvchimisiz? Hisob yarating"}</button>
        <p className="privacy-note"><ShieldCheck size={15} /> Javoblaringiz shaxsiy. Ularni faqat guruhingizdagi mutaxassis ko‘ra oladi.</p>
      </form></section>
    </main>
  );
}

function Dashboard({ user, groups, quizzes, overview, onNavigate, onCreate, onOpenQuiz }) {
  const canCreate = ["admin", "creator"].includes(user.role);
  const latest = quizzes.slice(0, 4);
  return <div className="dashboard-page">
    <section className="hero-panel">
      <div className="hero-copy"><span className="eyebrow"><span className="live-dot" /> PSIXOLOG AMALIYOTI</span><h1>Har bir kichik qadam<br />— <em>yaxshilanish sari.</em></h1><p>{canCreate ? "Mijozlaringiz uchun guruhlar va mulohaza testlarini qulay boshqaring." : "Sizga ulashilgan testlarni xotirjam muhitda topshiring."}</p><div className="hero-actions"><button className="button button-primary" onClick={canCreate ? onCreate : () => onNavigate("tests")}>{canCreate ? "Test yaratish" : "Testlarim"}<ArrowUpRight size={16} /></button><button className="button button-quiet" onClick={() => onNavigate("groups")}>Guruhlarni ko‘rish<ArrowRight size={16} /></button></div></div>
      <div className="hero-illustration"><img src="/images/therapy-hero.svg" alt="Psixolog va mijozning sokin suhbatini ifodalovchi illyustratsiya" /><span className="hero-note"><span className="note-icon"><Heart size={14} /></span> Xotirjam muhitda, o‘z sur’atingizda</span></div>
    </section>
    <section className="metric-grid" aria-label="Faoliyat ko‘rsatkichlari">
      <Metric icon={<Users size={18} />} label="Guruhlar" value={overview.group_count || 0} helper="Birgalikda ishlash maydoni" />
      <Metric icon={<UserRound size={18} />} label={user.role === "tester" ? "Mening guruhim" : "Mijozlar"} value={user.role === "tester" ? groups.length : overview.client_count || 0} helper={user.role === "tester" ? "Siz a’zo bo‘lgan guruhlar" : "Guruhlarga qo‘shilganlar"} />
      <Metric icon={<ClipboardList size={18} />} label="Testlar" value={overview.quiz_count || 0} helper="Guruhlar uchun tayyorlangan" />
      <Metric icon={<Activity size={18} />} label={user.role === "tester" ? "Javoblarim" : "Javoblar"} value={overview.response_count || 0} helper={user.role === "tester" ? "Topshirgan testlaringiz" : "Yuborilgan test javoblari"} />
    </section>
    <div className="dashboard-columns">
      <section className="surface-card recent-section"><div className="section-heading"><div><span className="eyebrow">DAVOM ETING</span><h2>So‘nggi testlar</h2></div><button className="text-link" onClick={() => onNavigate("tests")}>Barchasi<ArrowRight size={15} /></button></div>
        {latest.length ? <div className="recent-list">{latest.map(quiz => <article className="recent-item" key={quiz.id}><span className="recent-icon"><FileText size={18} /></span><span className="recent-text"><strong>{quiz.title}</strong><small>{quiz.group_name || "Guruh"} · {quiz.question_count} savol · {dateLabel(quiz.created_at)}</small></span><button className="icon-button" title="Testni ochish" onClick={() => onOpenQuiz(quiz)}><ArrowUpRight size={17} /></button></article>)}</div> : <EmptyMessage icon={<ClipboardList size={22} />} title="Hali testlar yo‘q" text={canCreate ? "Birinchi mulohaza testini yarating." : "Psixologingiz test ulashganda shu yerda ko‘rinadi."} action={canCreate ? <button className="text-link" onClick={onCreate}>Test yaratish<ArrowRight size={15} /></button> : null} />}
      </section>
      <section className="surface-card groups-section"><div className="section-heading"><div><span className="eyebrow">BIRGA ISHLASH</span><h2>Guruhlar</h2></div><button className="icon-button" title="Guruhlarni ko‘rish" onClick={() => onNavigate("groups")}><ArrowUpRight size={17} /></button></div>
        {groups.length ? <div className="mini-group-list">{groups.slice(0, 4).map((group, index) => <button className="mini-group" key={group.id} onClick={() => onNavigate("groups")}><span className={`group-color color-${index % 4}`}><Users size={17} /></span><span><strong>{group.name}</strong><small>{group.member_count} ishtirokchi · {group.quiz_count} test</small></span><ChevronRight size={16} /></button>)}</div> : <EmptyMessage icon={<Users size={22} />} title="Hali guruh yaratilmagan" text={user.role === "admin" ? "Mijozlar va testlar uchun yangi guruh oching." : "Guruhga taklif kodi orqali qo‘shiling."} action={<button className="text-link" onClick={() => onNavigate("groups")}>{user.role === "admin" ? "Guruh yaratish" : "Guruhga qo‘shilish"}<ArrowRight size={15} /></button>} />}
      </section>
    </div>
    <div className="privacy-banner"><span className="privacy-icon"><ShieldCheck size={18} /></span><span><strong>Maxfiylik birinchi o‘rinda</strong><small>Har bir javob faqat tegishli mijoz va ruxsatli mutaxassislarga ko‘rinadi.</small></span><BadgeCheck size={19} /></div>
  </div>;
}

function Metric({ icon, label, value, helper }) {
  return <article className="metric-card"><span className="metric-icon">{icon}</span><span className="metric-label">{label}</span><strong>{value}</strong><small>{helper}</small></article>;
}

function EmptyMessage({ icon, title, text, action }) {
  return <div className="empty-message"><span>{icon}</span><strong>{title}</strong><p>{text}</p>{action}</div>;
}

function GroupsPage({ user, groups, selectedGroup, selectedGroupId, setSelectedGroupId, members, groupForm, setGroupForm, onCreate, onSave, memberForm, setMemberForm, onAddMember, onRemoveMember, onJoin, onCopy, busy }) {
  const isAdmin = user.role === "admin";
  const [genderRule, setGenderRule] = useState(selectedGroup?.gender_rule || "all");
  useEffect(() => setGenderRule(selectedGroup?.gender_rule || "all"), [selectedGroup?.id, selectedGroup?.gender_rule]);
  return <div className="page-stack"><PageHeading eyebrow="HAMKORLIK MAYDONI" title="Guruhlar" subtitle={isAdmin ? "Mijozlaringiz va mutaxassislaringiz uchun xavfsiz ish guruhlari yarating." : "Siz qatnashadigan guruhlar va ularga tegishli testlar."} />
    {isAdmin && <section className="surface-card create-group-card"><div className="form-heading"><span className="form-icon"><Plus size={19} /></span><div><h2>Yangi guruh ochish</h2><p>Nom va qisqa izoh kiriting. Taklif kodi avtomatik yaratiladi.</p></div></div><form className="inline-create-form" onSubmit={onCreate}><label>Guruh nomi<input value={groupForm.name} onChange={event => setGroupForm({ ...groupForm, name: event.target.value })} minLength="2" maxLength="100" placeholder="Masalan, O‘smirlar guruhi" required /></label><label>Qisqa izoh<input value={groupForm.description} onChange={event => setGroupForm({ ...groupForm, description: event.target.value })} maxLength="500" placeholder="Guruh haqida" /></label><div className="group-rule-field"><span className="field-label">Guruhga kimlar qo‘shila oladi?</span><GroupGenderOptions value={groupForm.genderRule || "all"} onChange={value => setGroupForm(current => ({ ...current, genderRule: value }))} /></div><button className="button button-primary" disabled={busy}><Plus size={16} />Guruh yaratish</button></form></section>}
    {!isAdmin && user.role === "tester" && <section className="surface-card join-card"><span className="form-icon"><KeyRound size={18} /></span><div><h2>Taklif kodi bilan qo‘shilish</h2><p>Psixologingiz yuborgan kodni kiriting.</p></div><form onSubmit={onJoin}><input name="inviteCode" maxLength="32" placeholder="Guruh kodi" required /><button className="button button-primary" disabled={busy}>Guruhga qo‘shilish<ArrowRight size={15} /></button></form></section>}
    {groups.length ? <div className="group-layout"><section className="group-card-grid">{groups.map((group, index) => <article className={`group-card ${group.id === selectedGroupId ? "selected" : ""}`} key={group.id}><span className={`group-color color-${index % 4}`}><Users size={19} /></span><div className="group-card-copy"><span className="role-chip">{roleLabel(group.my_role)}</span><h3>{group.name}</h3><p>{group.description || "Guruh tavsifi qo‘shilmagan."}</p><span className={`group-gender-badge ${group.gender_rule === "all" ? "all" : group.gender_rule}`}>{genderRuleLabel(group.gender_rule)}</span></div><div className="group-card-stats"><span><UserRound size={14} />{group.member_count} ishtirokchi</span><span><ClipboardList size={14} />{group.quiz_count} test</span></div><button className="group-card-action" onClick={() => setSelectedGroupId(group.id)}>{isAdmin ? "Guruhni boshqarish" : "Guruhni ochish"}<ArrowRight size={15} /></button></article>)}</section>
        {selectedGroup && isAdmin && <section className="surface-card group-management"><div className="section-heading"><div><span className="eyebrow">GURUH SOZLAMALARI</span><h2>{selectedGroup.name}</h2></div><span className="status-pill"><span />Faol</span></div>
          <form className="group-edit-form" onSubmit={onSave}><label>Guruh nomi<input name="name" defaultValue={selectedGroup.name} maxLength="100" required /></label><label>Izoh<textarea name="description" defaultValue={selectedGroup.description} maxLength="500" rows="2" /></label><div className="group-rule-field"><span className="field-label">Guruhga kimlar qo‘shila oladi?</span><input type="hidden" name="genderRule" value={genderRule} /><GroupGenderOptions value={genderRule} onChange={setGenderRule} /></div><label className="check-row"><input name="rotateInvite" type="checkbox" />Eski taklif kodini bekor qilib, yangisini yaratish</label><button className="button button-outline" disabled={busy}>O‘zgarishlarni saqlash</button></form>
          <div className="invite-panel"><div><span className="eyebrow">MIJOZLAR UCHUN TAKLIF KODI</span><strong>{selectedGroup.invite_code}</strong><p>Kod bilan ro‘yxatdan o‘tgan foydalanuvchi shu guruhga qo‘shiladi.</p></div><button className="button button-primary" onClick={() => onCopy(selectedGroup.invite_code)}><Copy size={15} />Nusxalash</button></div>
          <div className="member-management"><div className="section-heading"><div><span className="eyebrow">GURUH A’ZOLARI</span><h3>Ishtirokchilar</h3></div><span className="section-meta">{members.length} kishi</span></div><form className="add-member-form" onSubmit={onAddMember}><label>Ro‘yxatdan o‘tgan foydalanuvchi nomi<input value={memberForm.username} onChange={event => setMemberForm({ ...memberForm, username: event.target.value })} minLength="2" maxLength="32" placeholder="Foydalanuvchi ismi" required /></label><label>Roli<select value={memberForm.role} onChange={event => setMemberForm({ ...memberForm, role: event.target.value })}><option value="tester">Tester — mijoz</option><option value="creator">Creator — test tuzuvchi</option></select></label><button className="button button-primary" disabled={busy}><Plus size={16} />Qo‘shish</button></form>
            <div className="member-list">{members.map(member => <article className="member-row" key={member.id}><Avatar value={member.avatar} gender={member.gender} /><span className="member-name"><strong>{member.first_name ? `${member.first_name} ${member.last_name}` : member.username}</strong><small>{member.response_count} ta javob yuborgan</small></span><span className={`gender-chip ${member.gender === "male" ? "male" : "female"}`}>{member.gender === "male" ? "Erkak" : "Ayol"}</span><span className={`role-chip ${member.member_role === "creator" ? "role-creator" : ""}`}>{roleLabel(member.member_role)}</span><button className="icon-button icon-danger" title="Guruhdan olib tashlash" onClick={() => onRemoveMember(member)}><X size={16} /></button></article>)}{!members.length && <p className="muted">Guruhda hali ishtirokchi yo‘q. Taklif kodini ulashing yoki foydalanuvchini qo‘shing.</p>}</div>
          </div>
        </section>}
      </div> : !isAdmin && user.role !== "tester" ? <EmptyMessage icon={<Users size={24} />} title="Sizga guruh biriktirilmagan" text="Admin sizni guruhga Creator sifatida qo‘shishi mumkin." /> : null}
  </div>;
}

const GROUP_GENDER_RULES = [
  { value: "all", label: "Barchasi", help: "Ayol va erkaklar", icon: <Users size={20} /> },
  { value: "female", label: "Faqat ayollar", help: "Ayol ishtirokchilar", icon: <Avatar value="woman" className="gender-option-avatar" /> },
  { value: "male", label: "Faqat erkaklar", help: "Erkak ishtirokchilar", icon: <Avatar value="man" className="gender-option-avatar" /> },
];

function genderRuleLabel(rule) {
  return GROUP_GENDER_RULES.find(option => option.value === rule)?.label || "Barchasi";
}

function GroupGenderOptions({ value, onChange }) {
  return <div className="group-gender-options" role="group" aria-label="Guruh ishtirokchilarining jinsi">
    {GROUP_GENDER_RULES.map(option => <button type="button" key={option.value} className={`group-gender-choice ${value === option.value ? "selected" : ""}`} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
      <span className="group-gender-choice-icon">{option.icon}</span><span className="group-gender-choice-copy"><strong>{option.label}</strong><small>{option.help}</small></span>
    </button>)}
  </div>;
}

function TestsPage({ user, quizzes, searchTerm, setSearchTerm, onCreate, onOpen, onResults, onDelete, busy }) {
  const canCreate = ["admin", "creator"].includes(user.role);
  return <div className="page-stack"><PageHeading eyebrow="MULOHAZA VA O‘ZINI ANGLASH" title="Guruh testlari" subtitle="Testlar maxfiy guruhlar ichida tarqatiladi. Har bir mijoz faqat o‘zi a’zo bo‘lgan guruhlarni ko‘radi." action={canCreate && <button className="button button-primary" onClick={onCreate}><Plus size={16} />Yangi test</button>} />
    <div className="list-toolbar"><label className="search-field"><Search size={17} /><input value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="Test nomi yoki guruh bo‘yicha qidiring" /></label><span>{quizzes.length} ta test</span></div>
    {quizzes.length ? <div className="test-list">{quizzes.map((quiz, index) => <article className="test-row" key={quiz.id}><span className={`test-art art-${index % 4}`}><BookOpen size={21} /></span><div className="test-row-main"><span className="test-group">{quiz.group_name || "Guruh testi"}</span><h3>{quiz.title}</h3><p>{quiz.description || "Qisqa mulohaza va o‘zini anglash savollari."}</p><div className="test-meta"><span><ClipboardList size={14} />{quiz.question_count} savol</span>{canCreate && <span><Users size={14} />{quiz.response_count} javob</span>}<span><Clock3 size={14} />{dateLabel(quiz.created_at)}</span></div></div><div className="test-row-actions">{canCreate && <button className="button button-outline" disabled={busy} onClick={() => onResults(quiz)}><Eye size={15} />Javoblar</button>}<button className="button button-primary" disabled={busy} onClick={() => onOpen(quiz)}>{canCreate ? "Ko‘rish" : "Testni boshlash"}<ArrowRight size={15} /></button>{quiz.can_delete && <button className="icon-button icon-danger" title="Testni o‘chirish" aria-label="Testni o‘chirish" onClick={() => onDelete(quiz.id, "deleteQuiz")}><X size={16} /></button>}</div></article>)}</div> : <EmptyMessage icon={<ClipboardList size={24} />} title="Bu yerda hozircha test yo‘q" text={canCreate ? "Guruh tanlab, birinchi mulohaza testingizni yarating." : "Psixologingiz guruhingiz uchun test joylaganda shu yerda ko‘rinadi."} action={canCreate && <button className="button button-primary" onClick={onCreate}><Plus size={16} />Test yaratish</button>} />}
  </div>;
}

function MembersPage({ users, groups, onManageGroups, onModerate }) {
  return <div className="page-stack"><PageHeading eyebrow="KABINET BOSHQARUVI" title="Ishtirokchilar" subtitle="Foydalanuvchilar hisobini va faolligini boshqaring. Ularni guruhga qo‘shish uchun Guruhlar bo‘limini oching." action={<button className="button button-outline" onClick={onManageGroups}><Users size={16} />Guruhlarni boshqarish</button>} />
    <div className="member-summary"><span>{users.length} ta hisob</span><span>{users.filter(item => item.role === "creator").length} ta Creator</span><span>{users.filter(item => item.is_banned).length} ta bloklangan</span></div>
    <section className="surface-card people-table"><div className="people-table-head"><span>FOYDALANUVCHI</span><span>ROL</span><span>FAOLIYAT</span><span>OXIRGI KIRISH</span><span>HOLAT</span><span>AMAL</span></div>
      {users.map(item => { const suspended = item.suspended_until && new Date(item.suspended_until) > new Date(); return <article className="people-table-row" key={item.id}><span className="people-name"><Avatar value={item.avatar} gender={item.gender} /><strong>{item.first_name || item.username} {item.last_name}</strong></span><span>{item.role === "admin" ? <span className="role-chip">Admin</span> : <select className="role-select" aria-label="Foydalanuvchi roli" value={item.role === "creator" ? "creator" : "tester"} onChange={event => onModerate(item.id, "role", { role: event.target.value })}><option value="tester">Tester</option><option value="creator">Creator</option></select>}</span><span>{item.quiz_count} test · {item.attempt_count} javob</span><span>{dateLabel(item.last_login_at)}</span><span><span className={`account-status ${item.is_banned || suspended ? "blocked" : ""}`}><i />{item.is_banned ? "Bloklangan" : suspended ? "Vaqtincha to‘xtatilgan" : "Faol"}</span></span><span className="people-actions">{item.role !== "admin" && <><button className="text-link" onClick={() => onModerate(item.id, item.is_banned || suspended ? "unban" : "ban")}>{item.is_banned || suspended ? "Qayta ochish" : "Bloklash"}</button><button className="text-link" onClick={() => onModerate(item.id, "suspend", { days: 7 })}>7 kunga to‘xtatish</button><button className="text-link" onClick={() => onModerate(item.id, "warn")}>Ogohlantirish</button><button className="text-link danger-link" onClick={() => onModerate(item.id, "delete")}>Hisobni o‘chirish</button></>}</span></article>; })}
      {!users.length && <EmptyMessage icon={<UserRound size={22} />} title="Hali foydalanuvchi yo‘q" text={groups.length ? "Guruh taklif kodini ulashing yoki foydalanuvchini guruh sozlamalaridan qo‘shing." : "Avval guruh yarating va taklif kodini ulashing."} />}
    </section>
  </div>;
}

function BuilderPage({ user, draft, setDraft, groups, aiTopic, setAiTopic, aiCount, setAiCount, aiProvider, busy, onAi, onPublish, onBack, onManageGroups, updateQuestion }) {
  function changeType(index, type) {
    updateQuestion(index, { type, options: type === "scale" ? ["Hech qachon", "Kamdan-kam", "Ba'zan", "Ko'pincha", "Deyarli har doim"] : type === "yes_no" ? ["Ha", "Yo‘q"] : type === "multiple" ? ["", "", "", ""] : [], correctOptionIndex: null });
  }
  function updateOption(questionIndex, optionIndex, value) {
    const question = draft.questions[questionIndex];
    updateQuestion(questionIndex, { options: question.options.map((option, index) => index === optionIndex ? value : option) });
  }
  return <div className="page-stack"><button className="back-link" onClick={onBack}><ArrowLeft size={15} />Testlarga qaytish</button><PageHeading eyebrow="TEST MUHARRIRI" title="Mulohaza testi yarating" subtitle="Savollarni o‘zingiz tuzing yoki AI yordamida boshlang. Test faqat tanlangan guruhda ko‘rinadi." />
    {!groups.length && <section className="builder-empty-group" role="status"><span className="builder-empty-icon"><Users size={21} /></span><div><strong>Test yaratish uchun avval guruh kerak</strong><p>{user.role === "admin" ? "Guruhlar bo‘limida guruh oching. Keyin testni shu yerda yaratib, guruhga joylaysiz." : "Admin sizni Creator sifatida guruhga qo‘shgach, test tuza olasiz."}</p></div>{user.role === "admin" && <button type="button" className="button button-outline" onClick={onManageGroups}>Guruh yaratish<ArrowRight size={15} /></button>}</section>}
    <div className="builder-layout"><form className="surface-card builder-form" onSubmit={onPublish}><label>Guruh<select required value={draft.groupId} onChange={event => setDraft({ ...draft, groupId: event.target.value })}><option value="">Guruhni tanlang</option>{groups.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label><label>Test nomi<input required minLength="2" maxLength="120" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder="Masalan, Haftalik holat" /></label><label>Qisqa izoh<textarea rows="2" maxLength="600" value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} placeholder="Mijozlarga testning maqsadini tushuntiring" /></label>
      <div className="editor-heading"><div><span className="eyebrow">SAVOLLAR</span><strong>{draft.questions.length} ta savol</strong></div><button type="button" className="button button-outline" onClick={() => setDraft({ ...draft, questions: [...draft.questions, { type: "yes_no", prompt: "", options: ["Ha", "Yo‘q"], correctOptionIndex: null }] })}><Plus size={15} />Savol qo‘shish</button></div>
      <div className="question-stack">{draft.questions.map((question, index) => <article className="editor-question" key={index}><div className="editor-question-top"><span>SAVOL {String(index + 1).padStart(2, "0")}</span><select aria-label="Savol turi" value={question.type} onChange={event => changeType(index, event.target.value)}><option value="yes_no">Ha yoki yo‘q</option><option value="scale">Shkala — mulohaza</option><option value="text">Ochiq javob</option><option value="multiple">Variant tanlash</option></select></div><textarea required maxLength="600" rows="2" value={question.prompt} onChange={event => updateQuestion(index, { prompt: event.target.value })} placeholder="Savolni yozing…" />
        {question.type === "text" && <p className="field-hint">Mijoz javobi maxfiy ravishda mutaxassisga ko‘rinadi.</p>}
        {question.type === "yes_no" && <div className="yes-no-preview"><span>Ha</span><span>Yo‘q</span><small>Har ikkala javob ham teng — ball berilmaydi.</small></div>}
        {!["text", "yes_no"].includes(question.type) && <div className="option-list">{question.options.map((option, optionIndex) => <label className="option-editor" key={optionIndex}><span className="scale-dot">{optionIndex + 1}</span><input value={option} onChange={event => updateOption(index, optionIndex, event.target.value)} required maxLength="300" placeholder={`Variant ${optionIndex + 1}`} /></label>)}</div>}
        {draft.questions.length > 1 && <button type="button" className="remove-question" onClick={() => setDraft({ ...draft, questions: draft.questions.filter((_, i) => i !== index) })}>Savolni o‘chirish</button>}</article>)}</div>
      <div className="builder-submit"><span><ShieldCheck size={16} />Test tanlangan guruh bilan cheklanadi</span><button className="button button-primary" disabled={busy || !groups.length}>{busy ? "Saqlanmoqda…" : "Testni guruhga joylash"}<ArrowUpRight size={16} /></button></div>
    </form><aside className="ai-card"><div className="ai-card-mark"><WandSparkles size={19} /><span>TESTSTUDIO AI</span></div><h2>G‘oyani savollarga aylantiring.</h2><p>Mavzuni yozing. AI mijozlar bilan muloyim suhbatga mos, javobi aniq bo‘lmagan mulohaza savollarini taklif qiladi.</p><label>Qaysi mavzu haqida?<textarea rows="3" value={aiTopic} onChange={event => setAiTopic(event.target.value)} placeholder="Masalan: kundalik stressni boshqarish" /></label><label>Savollar soni<select value={aiCount} onChange={event => setAiCount(event.target.value)}>{[3, 5, 7, 10].map(count => <option value={count} key={count}>{count} ta savol</option>)}</select></label><button className="button button-lime full-button" disabled={busy || aiTopic.trim().length < 2 || !draft.groupId} onClick={onAi}><Sparkles size={16} />{busy ? "Tayyorlanmoqda…" : "AI bilan savol yaratish"}</button>{aiProvider && <p className="provider-note">{aiProvider === "ai" ? "AI takliflarini nashrdan oldin tahrirlashingiz mumkin." : "Offline boshlang‘ich savollar tayyorlandi. AI uchun Render’da AI_API_KEY o‘zgaruvchisini sozlang."}</p>}<div className="ai-footnote"><ShieldCheck size={15} />AI klinik tashxis bermaydi. Har bir savolni mutaxassis ko‘rib chiqadi.</div></aside></div>
  </div>;
}

function PageHeading({ eyebrow, title, subtitle, action }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>;
}

function PlayPage({ data, answers, setAnswers, aiConsent, setAiConsent, attempt, busy, onSubmit, onBack }) {
  const { quiz, questions } = data;
  return <div className="page-stack play-page"><button className="back-link" onClick={onBack}><ArrowLeft size={15} />Testlarga qaytish</button><section className="play-intro"><span className="eyebrow">{quiz.group_name || "GURUH TESTI"} · {quiz.owner_name}</span><h1>{quiz.title}</h1><p>{quiz.description || "Javoblaringizni o‘zingizga qulay sur’atda belgilang."}</p><div className="play-prompt"><ShieldCheck size={17} /><span>Javoblaringiz maxfiy saqlanadi va mutaxassis tomonidan ko‘rib chiqiladi.</span></div></section>
    {attempt && <div className="completion-banner"><span><Check size={18} /></span><div><strong>Javoblaringiz qabul qilindi</strong><p>Bu test ball bilan baholanmaydi. Psixologingiz javoblaringizni siz bilan xotirjam muhokama qiladi.</p></div></div>}
    <form className="play-form" onSubmit={onSubmit}>{questions.map((question, index) => <article className="play-question" key={question.id}><span className="question-number">{String(index + 1).padStart(2, "0")}</span><div className="question-body"><h2>{question.prompt}</h2>{question.type === "text" ? <textarea rows="4" required disabled={Boolean(attempt)} value={answers[question.id] || ""} onChange={event => setAnswers({ ...answers, [question.id]: event.target.value })} placeholder="Javobingizni yozing…" /> : <div className={question.type === "scale" ? "scale-options" : "play-options"}>{question.options.map((option, optionIndex) => <label className={`play-option ${answers[question.id] === optionIndex ? "selected" : ""}`} key={optionIndex}><input type="radio" name={question.id} required disabled={Boolean(attempt)} checked={answers[question.id] === optionIndex} onChange={() => setAnswers({ ...answers, [question.id]: optionIndex })} /><span>{option}</span>{question.type === "scale" && <small>{optionIndex + 1}</small>}</label>)}</div>}</div></article>)}{!attempt && <><label className="ai-consent"><input type="checkbox" checked={aiConsent} onChange={event => setAiConsent(event.target.checked)} /><span><strong>AI mulohazasini olishga roziman (ixtiyoriy)</strong><small>Belgilasangiz, faqat savol va javoblaringiz AI xizmatiga tahlil uchun yuboriladi. Ism va akkaunt ma’lumotlari yuborilmaydi. Belgilamasangiz, javoblar saqlanib, faqat psixologingizga ko‘rinadi. AI sharhi tashxis emas.</small></span></label><button className="button button-primary submit-test" disabled={busy}>{busy ? "Saqlanmoqda…" : "Javoblarni yuborish"}<ArrowRight size={16} /></button></>}</form>
  </div>;
}

function ResultsPage({ data, onBack }) {
  const { quiz, questions, results } = data;
  return <div className="page-stack"><button className="back-link" onClick={onBack}><ArrowLeft size={15} />Testlarga qaytish</button><PageHeading eyebrow={`${quiz.group_name || "GURUH"} · JAVOBLAR`} title={quiz.title} subtitle="Javoblarni faqat ushbu guruhga ruxsati bor mutaxassislar ko‘ra oladi." /><div className="results-summary"><span><Users size={17} /><strong>{results.length}</strong> ta javob</span><span><ClipboardList size={17} /><strong>{questions.length}</strong> ta savol</span></div>
    {results.length ? <div className="response-list">{results.map(result => <details className="response-card" key={result.id}><summary><Avatar value={result.avatar} gender={result.gender} /><span><strong>{result.first_name ? `${result.first_name} ${result.last_name}` : result.username}</strong><small>{dateLabel(result.created_at)} · test topshirildi</small></span><ChevronRight size={17} /></summary><ReflectionPanel reflection={result.ai_reflection} consent={result.ai_consent} audience="psychologist" /><div className="response-answers">{questions.map((question, index) => { const answer = result.answers.find(item => item.questionId === question.id); return <article key={question.id}><span>SAVOL {String(index + 1).padStart(2, "0")}</span><strong>{question.prompt}</strong><p>{answer?.answer || "Javob berilmagan"}</p></article>; })}</div></details>)}</div> : <EmptyMessage icon={<FileText size={23} />} title="Hali javob kelmagan" text="Mijozlar testingizni topshirganda javoblari shu yerda paydo bo‘ladi." />}
  </div>;
}

function MyResultsPage({ results, loading, onGenerate, reflectionBusyId }) {
  return <div className="page-stack"><PageHeading eyebrow="SHAXSIY KABINET" title="Natijalar" subtitle="Yechgan testlaringiz, topshirgan sanangiz va javoblaringiz shu yerda saqlanadi. Bu testlarda ball qo‘yilmaydi." />
    {loading ? <div className="surface-card results-loading" role="status"><span className="live-dot" />Natijalar yuklanmoqda…</div> : results.length ? <div className="my-results-list">{results.map((result, index) => <article className="surface-card my-result-card" key={result.id}>
      <div className="my-result-heading"><span className={`test-art art-${index % 4}`}><FileText size={20} /></span><div className="my-result-title"><span className="eyebrow">{result.group_name || "GURUH"}</span><h2>{result.quiz_title}</h2><p>Psixolog: {result.psychologist}</p></div><time dateTime={result.created_at}><Clock3 size={14} />{dateTimeLabel(result.created_at)}</time></div>
      <ReflectionPanel reflection={result.ai_reflection} consent={result.ai_consent} audience="participant" attemptId={result.id} onGenerate={onGenerate} busy={reflectionBusyId === result.id} /><details className="my-result-details"><summary>Javoblarimni ko‘rish<ChevronRight size={16} /></summary><div className="response-answers">{result.responses.map((response, responseIndex) => <article key={`${result.id}-${responseIndex}`}><span>SAVOL {String(responseIndex + 1).padStart(2, "0")}</span><strong>{response.question}</strong><p>{response.answer || "Javob berilmagan"}</p></article>)}</div></details>
      <div className="my-result-note"><ShieldCheck size={16} /><span>Bu testda ball berilmaydi. AI tavsifi javoblaringizdan kelib chiqadigan ehtimoliy xususiyatlarni ko‘rsatadi — tashxis emas.</span></div>
    </article>)}</div> : <EmptyMessage icon={<Clock3 size={23} />} title="Hali topshirilgan test yo‘q" text="Testni topshirganingizdan so‘ng, sanasi va javoblaringiz bu yerda ko‘rinadi." />}
  </div>;
}

function ReflectionPanel({ reflection, consent, audience, attemptId, onGenerate, busy }) {
  if (!consent && audience === "psychologist") return <p className="reflection-muted">Foydalanuvchi AI tahliliga rozilik bermagan; javoblarini o‘zingiz ko‘rib chiqing.</p>;
  if (!reflection) return <section className="reflection-panel reflection-empty"><div className="reflection-title"><Sparkles size={17} /><h3>AI tavsifi hali yaratilmagan</h3></div><p>Javoblaringizdan kelib chiqib, ehtimoliy fe’l-atvor va kundalik tutum haqida alohida tavsif oling. Bu tashxis emas.</p>{audience === "participant" && <button type="button" className="button button-primary" disabled={busy} onClick={() => onGenerate(attemptId)}>{busy ? "Tavsif tayyorlanmoqda…" : consent ? "AI tavsifini qayta yaratish" : "AI tavsifini olish"}</button>}<small>{audience === "participant" ? "Bosganda rozilik so‘raladi; faqat shu testning savollari va javoblari yuboriladi." : "Tavsif faqat foydalanuvchi rozilik berganda yaratiladi."}</small></section>;
  const followUp = {
    routine: "Javoblaringizda hozircha alohida xavfsizlik signali ko‘rinmadi. Tavsifni o‘zingizga mosligi bo‘yicha baholang.",
    check_in: "Bu mavzuni yaqin fursatda psixolog bilan ko‘rib chiqish foydali bo‘lishi mumkin.",
    urgent: "Javoblarda hozirgi xavfsizlikka oid xavotir bo‘lishi mumkin. Agar ayni damda o‘zingiz yoki boshqa birov xavf ostida deb o‘ylasangiz, ishonchli kishiga darhol ayting va mahalliy shoshilinch yordamga murojaat qiling."
  }[reflection.followUp] || "Javoblaringizda hozircha alohida xavfsizlik signali ko‘rinmadi. Tavsifni o‘zingizga mosligi bo‘yicha baholang.";
  return <section className="reflection-panel" aria-label="AI mulohazasi"><div className="reflection-title"><Sparkles size={17} /><h3>AI mulohazasi</h3></div><p className="reflection-description">{reflection.description}</p>{Array.isArray(reflection.observations) && reflection.observations.length > 0 && <ul>{reflection.observations.map((item, index) => <li key={index}>{item}</li>)}</ul>}{Array.isArray(reflection.conversationPrompts) && reflection.conversationPrompts.length > 0 && <div className="reflection-prompts"><strong>Suhbat uchun savollar</strong><ul>{reflection.conversationPrompts.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}<p className="reflection-followup"><strong>Keyingi qadam:</strong> {followUp}</p><small>Bu sharh faqat ushbu testdagi javoblarga asoslangan, taxminiy mulohaza. U tashxis yoki mutaxassis xulosasining o‘rnini bosmaydi.</small></section>;
}

function SettingsPage({ user, draft, setDraft, onSave, busy }) {
  const avatars = ["woman", "girl", "woman-sage", "woman-rose", "man", "boy", "man-blue", "man-olive"];
  const languages = [{ value: "uz", label: "O‘zbekcha", note: "UZ" }, { value: "ru", label: "Русский", note: "RU" }, { value: "en", label: "English", note: "EN" }];
  const textSizes = [{ value: "small", label: "Kichik", sample: "Aa", className: "sample-small" }, { value: "medium", label: "O‘rtacha", sample: "Aa", className: "sample-medium" }, { value: "large", label: "Katta", sample: "Aa", className: "sample-large" }];
  function chooseGender(gender) {
    setDraft(current => {
      const femaleAvatars = ["woman", "girl", "woman-sage", "woman-rose"];
      const maleAvatars = ["man", "boy", "man-blue", "man-olive"];
      const mismatchedAvatar = gender === "male" ? femaleAvatars.includes(current.avatar) : maleAvatars.includes(current.avatar);
      return { ...current, gender, avatar: mismatchedAvatar ? (gender === "male" ? "man" : "woman") : current.avatar };
    });
  }
  return <div className="page-stack">
    <PageHeading eyebrow="SHAXSIY KABINET" title="Sozlamalar" subtitle="Til, matn hajmi va profil ko‘rinishini sozlang." />
    <form className="surface-card settings-card" onSubmit={onSave}>
      <section className="settings-section"><div><h2>Profil belgisi</h2><p>{user.firstName || user.username} {user.lastName} · {draft.gender === "male" ? "Erkak" : "Ayol"}</p></div><div className="avatar-picker">{avatars.map(icon => <button type="button" key={icon} className={`avatar-choice ${draft.avatar === icon ? "selected" : ""}`} aria-label={`Profil belgisi: ${icon}`} onClick={() => setDraft(current => ({ ...current, avatar: icon }))}><Avatar value={icon} className="settings-avatar" /></button>)}</div></section>
      <section className="settings-section settings-choice-section"><div><h2>Jins</h2><p>Profilingizdagi jins ma’lumotini o‘zgartiring.</p></div><div className="settings-option-list gender-options" role="group" aria-label="Jins">
        {[{ value: "female", label: "Ayol", avatar: "woman" }, { value: "male", label: "Erkak", avatar: "man" }].map(option => <button key={option.value} type="button" className={`settings-option gender-option ${draft.gender === option.value ? "selected" : ""}`} aria-pressed={draft.gender === option.value} onClick={() => chooseGender(option.value)}><Avatar value={option.avatar} className="settings-avatar" /><span>{option.label}</span>{draft.gender === option.value && <Check size={15} />}</button>)}
      </div></section>
      <section className="settings-section settings-choice-section"><div><h2>Til</h2><p>Ilova tilini tanlang.</p></div><div className="settings-option-list language-options" role="group" aria-label="Til">
        {languages.map(option => <button key={option.value} type="button" className={`settings-option language-option ${draft.language === option.value ? "selected" : ""}`} aria-pressed={draft.language === option.value} onClick={() => setDraft(current => ({ ...current, language: option.value }))}><small>{option.note}</small><span>{option.label}</span>{draft.language === option.value && <Check size={15} />}</button>)}
      </div></section>
      <section className="settings-section settings-choice-section"><div><h2>Matn hajmi</h2><p>Yozuvlarni o‘qishga qulay qilib kattalashtiring.</p></div><div className="settings-option-list size-options" role="group" aria-label="Matn hajmi">
        {textSizes.map(option => <button key={option.value} type="button" className={`settings-option size-option ${draft.textSize === option.value ? "selected" : ""}`} aria-pressed={draft.textSize === option.value} onClick={() => setDraft(current => ({ ...current, textSize: option.value }))}><strong className={option.className}>{option.sample}</strong><span>{option.label}</span></button>)}
      </div></section>
      <section className="settings-section"><div><h2>Rang mavzusi</h2><p>O‘zingizga qulay rang mavzusini tanlang.</p></div><div className="theme-switch"><button type="button" className={draft.theme === "light" ? "selected" : ""} onClick={() => setDraft(current => ({ ...current, theme: "light" }))}><Sun size={16} />Yorug‘</button><button type="button" className={draft.theme === "dark" ? "selected" : ""} onClick={() => setDraft(current => ({ ...current, theme: "dark" }))}><Moon size={16} />Tungi</button></div></section>
      <div className="settings-footer"><span><ShieldCheck size={15} />Hisobingiz himoyalangan</span><button className="button button-primary" disabled={busy}>{busy ? "Saqlanmoqda…" : "Sozlamalarni saqlash"}<Check size={16} /></button></div>
    </form>
  </div>;
}

export default App;
