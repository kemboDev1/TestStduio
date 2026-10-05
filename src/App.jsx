import { useEffect, useState } from "react";
import {
  Activity, ArrowLeft, ArrowUpRight, BadgeCheck, Ban, BookOpen,
  Check, CircleHelp, LogOut, MessageCircle,
  Plus, Send, Shield, Sparkles, Trophy, Users, WandSparkles, Settings2,
  Sun, Moon, ImagePlus
} from "lucide-react";
import { api, jsonBody } from "./api.js";
import { translate } from "./i18n.js";

const LANG_KEY = "teststudio.language";
const LANGUAGES = ["uz", "ru", "en"];
const readLanguage = () => {
  try {
    const value = window.localStorage.getItem(LANG_KEY);
    return LANGUAGES.includes(value) ? value : "en";
  } catch {
    return "en";
  }
};

const blankQuestion = () => ({
  type: "multiple",
  prompt: "",
  options: ["", "", "", ""],
  correctOptionIndex: 0
});

function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState("discover");
  const [quizzes, setQuizzes] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [adminUsers, setAdminUsers] = useState([]);
  const [selectedQuiz, setSelectedQuiz] = useState(null);
  const [comments, setComments] = useState([]);
  const [answers, setAnswers] = useState({});
  const [attempt, setAttempt] = useState(null);
  const [feedback, setFeedback] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ username: "", password: "" });
  const [draft, setDraft] = useState({ title: "", description: "", questions: [blankQuestion()] });
  const [aiTopic, setAiTopic] = useState("");
  const [aiCount, setAiCount] = useState(5);
  const [aiProvider, setAiProvider] = useState("");
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const language = user?.language || readLanguage();
  const t = (text, values) => translate(language, text, values);

  useEffect(() => {
    api("/auth/me")
      .then(payload => setUser(payload.user))
      .catch(error => setNotice(t(error.message)))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    try { window.localStorage.setItem(LANG_KEY, language); } catch { /* storage unavailable */ }
  }, [language]);

  useEffect(() => {
    if (user) document.documentElement.dataset.theme = user.theme || "light";
    else delete document.documentElement.dataset.theme;
  }, [user?.theme]);

  useEffect(() => {
    if (!user) return;
    api("/quizzes").then(payload => setQuizzes(payload.quizzes)).catch(error => setNotice(t(error.message)));
    api("/leaderboard").then(payload => setLeaderboard(payload.users)).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (view !== "admin" || user?.role !== "admin") return;
    api("/admin/users").then(payload => setAdminUsers(payload.users)).catch(error => setNotice(t(error.message)));
  }, [view, user]);

  function announce(message) {
    setNotice(t(message));
    window.setTimeout(() => setNotice(""), 4200);
  }

  async function submitAuth(event) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const payload = await api(`/auth/${authMode === "register" ? "register" : "login"}`, {
        method: "POST",
        body: jsonBody(authForm)
      });
      setUser(payload.user);
      setView("discover");
      setAuthForm({ username: "", password: "" });
    } catch (error) {
      announce(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    setSelectedQuiz(null);
    setView("discover");
  }

  function openSettings() {
    setSettingsDraft({ theme: user.theme || "light", language: user.language || "en", avatar: user.avatar || "" });
    setView("settings");
  }

  async function saveSettings(event) {
    event.preventDefault();
    setSettingsBusy(true);
    try {
      const payload = await api("/auth/settings", { method: "PATCH", body: jsonBody(settingsDraft) });
      setUser(payload.user);
      setSettingsDraft({ theme: payload.user.theme, language: payload.user.language, avatar: payload.user.avatar || "" });
      announce(translate(payload.user.language, "Settings saved."));
    } catch (error) {
      announce(error.message);
    } finally {
      setSettingsBusy(false);
    }
  }

  async function openQuiz(quiz) {
    setBusy(true);
    try {
      const [detail, commentData] = await Promise.all([
        api(`/quizzes/${quiz.id}`),
        api(`/quizzes/${quiz.id}/comments`)
      ]);
      setSelectedQuiz(detail);
      setComments(commentData.comments);
      setAnswers({});
      setAttempt(null);
      setFeedback("");
      setView("play");
    } catch (error) {
      announce(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function generateWithAi() {
    setBusy(true);
    try {
      const payload = await api("/ai/questions", {
        method: "POST",
        body: jsonBody({ topic: aiTopic, count: Number(aiCount) })
      });
      setDraft(current => ({
        ...current,
        title: current.title || payload.title,
        description: current.description || payload.description,
        questions: payload.questions.map(question => ({
          type: question.type,
          prompt: question.prompt,
          options: question.options,
          correctOptionIndex: question.correctOptionIndex
        }))
      }));
      setAiProvider(payload.provider);
      announce(t(payload.provider === "ai" ? "AI questions ready." : "Offline generator used. Add AI_API_KEY in server settings for generative questions."));
    } catch (error) {
      announce(error.message);
    } finally {
      setBusy(false);
    }
  }

  function updateQuestion(index, changes) {
    setDraft(current => ({
      ...current,
      questions: current.questions.map((question, questionIndex) => questionIndex === index ? { ...question, ...changes } : question)
    }));
  }

  async function publishQuiz(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = await api("/quizzes", { method: "POST", body: jsonBody(draft) });
      setQuizzes(current => [payload.quiz, ...current]);
      setDraft({ title: "", description: "", questions: [blankQuestion()] });
      setAiProvider("");
      setView("discover");
      announce(t("Test published to everyone."));
    } catch (error) {
      announce(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitAttempt(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = await api(`/quizzes/${selectedQuiz.quiz.id}/attempts`, {
        method: "POST",
        body: jsonBody({ answers: selectedQuiz.questions.map(question => ({
          questionId: question.id,
          selectedOptionIndex: answers[question.id],
          text: answers[question.id]
        })) })
      });
      setAttempt(payload.attempt);
      announce(payload.attempt.is_practice
        ? t("Result: {score}/{total} · private practice", { score: payload.attempt.score, total: payload.attempt.total_scoreable })
        : t("Result: {score}/{total}", { score: payload.attempt.score, total: payload.attempt.total_scoreable }));
      if (!payload.attempt.is_practice) api("/leaderboard").then(data => setLeaderboard(data.users)).catch(() => {});
    } catch (error) {
      announce(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendFeedback(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = await api(`/quizzes/${selectedQuiz.quiz.id}/comments`, {
        method: "POST",
        body: jsonBody({ body: feedback })
      });
      setComments(current => [payload.comment, ...current]);
      setFeedback("");
      announce(t("Feedback sent to the test owner."));
    } catch (error) {
      announce(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function moderate(id, action) {
    try {
      const payload = await api(`/admin/users/${id}`, { method: "PATCH", body: jsonBody({ action }) });
      setAdminUsers(current => current.map(item => item.id === id ? { ...item, ...payload.user } : item));
      announce(t(action === "warn" ? "Warning added." : action === "ban" ? "Account banned." : "Account reactivated."));
    } catch (error) {
      announce(error.message);
    }
  }

  if (!ready) return <div className="boot-screen"><span className="boot-mark">TS</span><p>{t("Loading TestStudio...")}</p></div>;
  if (!user) {
    return <AuthScreen mode={authMode} setMode={setAuthMode} form={authForm} setForm={setAuthForm} onSubmit={submitAuth} busy={busy} notice={notice} t={t} />;
  }

  return (
    <div className="studio-app" data-theme={user.theme || "light"}>
      <header className="topbar">
        <a className="brand" href="#discover" onClick={event => { event.preventDefault(); setView("discover"); }}>
          <span className="brand-mark">TS</span><span>test<span className="brand-light">studio</span></span>
        </a>
        <nav className="main-nav" aria-label={t("Main navigation")}>
          <NavButton active={view === "discover"} onClick={() => setView("discover")} icon={<BookOpen size={16} />}>{t("Discover")}</NavButton>
          <NavButton active={view === "builder"} onClick={() => setView("builder")} icon={<Plus size={16} />}>{t("Studio")}</NavButton>
          <NavButton active={view === "leaderboard"} onClick={() => setView("leaderboard")} icon={<Trophy size={16} />}>{t("Leaderboard")}</NavButton>
          <NavButton active={view === "settings"} onClick={openSettings} icon={<Settings2 size={16} />}>{t("Settings")}</NavButton>
          {user.role === "admin" && <NavButton active={view === "admin"} onClick={() => setView("admin")} icon={<Shield size={16} />}>{t("Admin")}</NavButton>}
        </nav>
        <div className="account-tools">
          <Avatar className="account-avatar" value={user.avatar} />
          <span className="account-name">{user.username}</span>
          {user.role === "admin" && <span className="role-tag">ADMIN</span>}
          <button className="icon-button" onClick={signOut} title={t("Sign out")} aria-label={t("Sign out")}><LogOut size={17} /></button>
        </div>
      </header>

      {notice && <div className="notice-bar" role="status"><span>{notice}</span><button onClick={() => setNotice("")} aria-label={t("Close")}>×</button></div>}

      <main className="page-shell">
        {view === "discover" && <DiscoverView quizzes={quizzes} user={user} onOpen={openQuiz} onCreate={() => setView("builder")} busy={busy} t={t} />}
        {view === "builder" && <BuilderView onBack={() => setView("discover")} draft={draft} setDraft={setDraft} updateQuestion={updateQuestion} onPublish={publishQuiz} busy={busy} aiTopic={aiTopic} setAiTopic={setAiTopic} aiCount={aiCount} setAiCount={setAiCount} onAi={generateWithAi} aiProvider={aiProvider} t={t} />}
        {view === "play" && selectedQuiz && <PlayView quizData={selectedQuiz} user={user} answers={answers} setAnswers={setAnswers} attempt={attempt} onSubmit={submitAttempt} comments={comments} feedback={feedback} setFeedback={setFeedback} onFeedback={sendFeedback} onBack={() => setView("discover")} busy={busy} t={t} />}
        {view === "leaderboard" && <LeaderboardView users={leaderboard} t={t} />}
        {view === "settings" && settingsDraft && <SettingsView user={user} draft={settingsDraft} setDraft={setSettingsDraft} onSave={saveSettings} busy={settingsBusy} t={t} />}
        {view === "admin" && user.role === "admin" && <AdminView users={adminUsers} onModerate={moderate} t={t} />}
      </main>
      <footer className="site-footer"><span>TESTSTUDIO</span><span>{t("Made for questions worth sharing.")}</span><span><Activity size={14} /> {t("Connected workspace")}</span></footer>
    </div>
  );
}

function AuthScreen({ mode, setMode, form, setForm, onSubmit, busy, notice, t }) {
  const registering = mode === "register";
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <a className="brand auth-brand" href="/"><span className="brand-mark">TS</span><span>test<span className="brand-light">studio</span></span></a>
        <div className="auth-story-copy">
          <span className="eyebrow"><Sparkles size={14} /> {t("COMMUNITY QUIZ STUDIO")}</span>
          <h1>{t("Good questions")}<br /><em>{t("travel further.")}</em></h1>
          <p>{t("Build a test, share it with everyone, and get feedback from the people who take it.")}</p>
        </div>
        <div className="auth-stats"><span><strong>01</strong> {t("Make a test")}</span><span><strong>02</strong> {t("Share it")}</span><span><strong>03</strong> {t("Learn together")}</span></div>
      </section>
      <section className="auth-card-wrap">
        <form className="auth-card" onSubmit={onSubmit}>
          <div className="form-kicker">{t("YOUR STUDIO")}</div>
          <h2>{t(registering ? "Create your account" : "Welcome back")}</h2>
          <p className="muted">{t(registering ? "A name and password are all you need to begin." : "Sign in to your TestStudio account.")}</p>
          <label>{t("Display name")}<input autoComplete="username" minLength="2" maxLength="32" value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} required placeholder={t("e.g. Samira")} /></label>
          <label>{t("Password")}<input autoComplete={registering ? "new-password" : "current-password"} type="password" minLength={registering ? 8 : 1} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} required placeholder={t(registering ? "At least 8 characters" : "Your password")} /></label>
          {notice && <p className="form-error" role="alert">{notice}</p>}
          <button className="button button-dark full-button" disabled={busy}>{busy ? t("Please wait...") : t(registering ? "Create account" : "Sign in")}<ArrowUpRight size={17} /></button>
          <button type="button" className="text-button" onClick={() => setMode(registering ? "login" : "register")}>
            {t(registering ? "Already have an account? Sign in" : "New here? Create an account")}
          </button>
          <p className="privacy-note"><Shield size={13} /> {t("Passwords are securely hashed. Your tests are stored in the shared database.")}</p>
        </form>
      </section>
    </main>
  );
}

function NavButton({ active, onClick, icon, children }) {
  return <button className={`nav-button ${active ? "is-active" : ""}`} onClick={onClick}>{icon}{children}</button>;
}

function DiscoverView({ quizzes, user, onOpen, onCreate, busy, t }) {
  const ownCount = quizzes.filter(quiz => quiz.owner_id === user.id).length;
  return (
    <>
      <section className="welcome-band">
        <div className="welcome-copy"><span className="eyebrow">{t("THE QUESTION EXCHANGE · 2026")}</span><h1>{t("Ideas become")}<br /><em>{t("better questions.")}</em></h1><p>{t("Explore community-made tests, or publish one of your own.")}</p><button className="button button-dark" onClick={onCreate}>{t("Create a test")} <ArrowUpRight size={16} /></button></div>
        <div className="welcome-aside"><div className="orbit-stamp"><CircleHelp size={42} strokeWidth={1.2} /><span>{t("ASK")}<br />{t("MORE")}</span></div><div className="welcome-number">{quizzes.length.toString().padStart(2, "0")}<small>{t("PUBLIC TESTS")}</small></div></div>
      </section>
      <div className="section-heading"><div><span className="eyebrow">{t("OPEN TO EVERYONE")}</span><h2>{t("Community tests")}</h2></div><span className="section-meta">{ownCount} {t("by you")} <span>/</span> {quizzes.length} {t("total")}</span></div>
      {quizzes.length ? <div className="quiz-grid">{quizzes.map((quiz, index) => <QuizCard key={quiz.id} quiz={quiz} index={index} onClick={() => onOpen(quiz)} busy={busy} t={t} />)}</div> : <div className="empty-state"><BookOpen size={24} /><h3>{t("First question is yours.")}</h3><p>{t("No tests have been published yet.")}</p><button className="button button-outline" onClick={onCreate}>{t("Build the first test")} <ArrowUpRight size={16} /></button></div>}
    </>
  );
}

function QuizCard({ quiz, index, onClick, busy, t }) {
  const accent = ["mint", "peach", "lemon", "lilac"][index % 4];
  return (
    <article className={`quiz-card accent-${accent}`}>
      <div className="quiz-card-top"><span className="question-count">{String(quiz.question_count).padStart(2, "0")} {t("QUESTIONS")}</span><span className="quiz-index">{String(index + 1).padStart(2, "0")}</span></div>
      <h3>{quiz.title}</h3><p>{quiz.description || t("A community quiz waiting to be explored.")}</p>
      <div className="quiz-card-footer"><span><span className="owner-dot">{quiz.owner_name?.[0]?.toUpperCase()}</span> {quiz.owner_name}</span><span><MessageCircle size={14} /> {quiz.comment_count}</span></div>
      <button className="card-open" disabled={busy} onClick={onClick} aria-label={t("Open {title}", { title: quiz.title })}><ArrowUpRight size={18} /></button>
    </article>
  );
}

function BuilderView({ onBack, draft, setDraft, updateQuestion, onPublish, busy, aiTopic, setAiTopic, aiCount, setAiCount, onAi, aiProvider, t }) {
  function updateOption(questionIndex, optionIndex, value) {
    const question = draft.questions[questionIndex];
    updateQuestion(questionIndex, { options: question.options.map((option, index) => index === optionIndex ? value : option) });
  }
  function changeType(index, type) {
    updateQuestion(index, { type, options: type === "multiple" ? ["", "", "", ""] : [], correctOptionIndex: 0 });
  }
  return (
    <section className="builder-page">
      <button className="back-link" onClick={onBack}><ArrowLeft size={15} /> {t("Back to tests")}</button>
      <div className="builder-heading"><div><span className="eyebrow">{t("TESTSTUDIO / EDITOR")}</span><h1>{t("Build your next")}<br /><em>{t("great question.")}</em></h1></div><span className="draft-label">{t("DRAFT · {count} QUESTIONS", { count: draft.questions.length })}</span></div>
      <div className="builder-layout">
        <form className="builder-form" onSubmit={onPublish}>
          <label>{t("Test title")}<input required minLength="2" maxLength="120" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder={t("What will people learn?")} /></label>
          <label>{t("Short description")}<textarea maxLength="600" value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} placeholder={t("Set the scene for your test")} rows="3" /></label>
          <div className="question-stack">
            {draft.questions.map((question, index) => <div className="editor-question" key={index}>
              <div className="editor-question-top"><span>{t("QUESTION {number}", { number: String(index + 1).padStart(2, "0") })}</span><select value={question.type} onChange={event => changeType(index, event.target.value)}><option value="multiple">{t("Multiple choice")}</option><option value="text">{t("Open answer")}</option></select></div>
              <textarea required value={question.prompt} onChange={event => updateQuestion(index, { prompt: event.target.value })} maxLength="600" placeholder={t("Write a clear, interesting question...")} rows="2" />
              {question.type === "multiple" && <div className="option-list">{question.options.map((option, optionIndex) => <label className="option-editor" key={optionIndex}><input type="radio" name={`correct-${index}`} checked={question.correctOptionIndex === optionIndex} onChange={() => updateQuestion(index, { correctOptionIndex: optionIndex })} aria-label={t("Set answer {number} as correct", { number: optionIndex + 1 })} /><input value={option} onChange={event => updateOption(index, optionIndex, event.target.value)} required placeholder={t("Answer {number}", { number: optionIndex + 1 })} /></label>)}</div>}
              {draft.questions.length > 1 && <button type="button" className="remove-question" onClick={() => setDraft({ ...draft, questions: draft.questions.filter((_, questionIndex) => questionIndex !== index) })}>{t("Remove question")}</button>}
            </div>)}
          </div>
          <div className="builder-actions"><button type="button" className="button button-outline" onClick={() => setDraft({ ...draft, questions: [...draft.questions, blankQuestion()] })}><Plus size={16} /> {t("Add question")}</button><button disabled={busy} className="button button-dark">{busy ? t("Publishing...") : t("Publish test")}<ArrowUpRight size={16} /></button></div>
        </form>
        <aside className="ai-panel">
          <div className="ai-panel-top"><span className="ai-icon"><WandSparkles size={19} /></span><span className="ai-status"><span /> STUDIO AI</span></div>
          <h2>{t("Skip the blank page.")}</h2><p>{t("Give the assistant a topic. It will draft varied questions and answer choices for you to edit.")}</p>
          <label>{t("Describe your quiz topic")}<input value={aiTopic} onChange={event => setAiTopic(event.target.value)} maxLength="500" placeholder={t("e.g. Oila haqida: mehr, qadriyatlar va muloqot")} /></label>
          <label>{t("Questions")}<select value={aiCount} onChange={event => setAiCount(event.target.value)}>{[3, 5, 7, 10].map(count => <option key={count} value={count}>{t("{count} questions", { count })}</option>)}</select></label>
          <button className="button button-acid full-button" onClick={onAi} disabled={busy || aiTopic.trim().length < 2}><Sparkles size={16} /> {busy ? t("Thinking...") : t("Generate questions")}</button>
          {aiProvider && <p className="provider-note">{t(aiProvider === "ai" ? "Generated with your configured AI provider." : "Offline starter set. Add AI_API_KEY in .env for generative questions.")}</p>}
          <div className="ai-footnote"><BadgeCheck size={14} /> {t("Review every answer before publishing.")}</div>
        </aside>
      </div>
    </section>
  );
}

function PlayView({ quizData, user, answers, setAnswers, attempt, onSubmit, comments, feedback, setFeedback, onFeedback, onBack, busy, t }) {
  const { quiz, questions } = quizData;
  const isOwner = quiz.owner_id === user.id;
  return (
    <section className="play-page">
      <button className="back-link" onClick={onBack}><ArrowLeft size={15} /> {t("All tests")}</button>
      <div className="play-hero"><span className="eyebrow">{t("BY {name}", { name: quiz.owner_name?.toUpperCase() })}</span><h1>{quiz.title}</h1><p>{quiz.description}</p><div className="play-meta"><span><CircleHelp size={15} /> {t("{count} questions", { count: questions.length })}</span><span><MessageCircle size={15} /> {t("{count} feedback notes", { count: comments.length })}</span></div>{isOwner && <p className="practice-note">{t("Your own test will be saved as private practice and won't affect the leaderboard.")}</p>}</div>
      {attempt && <div className="score-banner"><span><Trophy size={20} /> {t("Your score")}</span><strong>{attempt.score}<small> / {attempt.total_scoreable}</small></strong></div>}
      <form onSubmit={onSubmit} className="play-questions">
        {questions.map((question, index) => <article className="play-question" key={question.id}><div className="question-number">{String(index + 1).padStart(2, "0")}</div><div className="question-body"><h2>{question.prompt}</h2>{question.type === "text" ? <textarea rows="3" disabled={Boolean(attempt)} value={answers[question.id] || ""} onChange={event => setAnswers({ ...answers, [question.id]: event.target.value })} placeholder={t("Write your answer...")} /> : <div className="play-options">{question.options.map((option, optionIndex) => <label className={`play-option ${answers[question.id] === optionIndex ? "selected" : ""} ${attempt && question.correct_option_index === optionIndex ? "is-correct" : ""}`} key={optionIndex}><input type="radio" name={question.id} disabled={Boolean(attempt)} checked={answers[question.id] === optionIndex} onChange={() => setAnswers({ ...answers, [question.id]: optionIndex })} /><span>{option}</span>{attempt && question.correct_option_index === optionIndex && <Check size={16} />}</label>)}</div>}</div></article>)}
        {!attempt && <button className="button button-dark" disabled={busy}>{isOwner ? t("Run private practice") : t("Submit answers")}<ArrowUpRight size={16} /></button>}
      </form>
      <section className="feedback-section"><div className="section-heading"><div><span className="eyebrow">{t("AFTER THE TEST")}</span><h2>{t("Feedback to the creator")}</h2></div></div>
        {!isOwner && attempt && <form className="feedback-form" onSubmit={onFeedback}><textarea value={feedback} onChange={event => setFeedback(event.target.value)} maxLength="1200" rows="2" placeholder={t("What worked well? What could be clearer?")} required /><button className="button button-dark" disabled={busy}><Send size={15} /> {t("Send feedback")}</button></form>}
        {!isOwner && !attempt && <p className="muted feedback-gate">{t("Complete the test to leave a note for its creator.")}</p>}
        <div className="comment-list">{comments.map(comment => <article className="comment" key={comment.id}><div className="comment-avatar">{comment.author_name?.[0]?.toUpperCase()}</div><div><div className="comment-meta"><strong>{comment.author_name}</strong><time>{new Date(comment.created_at).toLocaleString()}</time></div><p>{comment.body}</p></div></article>)}{!comments.length && <p className="muted">{t("No feedback yet.")}</p>}</div>
      </section>
    </section>
  );
}

function LeaderboardView({ users, t }) {
  return <section className="table-page"><div className="section-heading"><div><span className="eyebrow">{t("COMMUNITY PARTICIPATION")}</span><h1>{t("Leaderboard")}</h1></div><span className="section-meta"><Users size={15} /> {t("{count} players", { count: users.length })}</span></div><div className="leaderboard-table"><div className="table-head"><span>{t("RANK")}</span><span>{t("PLAYER")}</span><span>{t("TESTS ANSWERED")}</span></div>{users.map((entry, index) => <div className={`leader-row ${index === 0 ? "top-player" : ""}`} key={entry.id}><span className="rank-number">{String(index + 1).padStart(2, "0")}</span><strong><Avatar className="account-avatar" value={entry.avatar} />{entry.username}</strong><b>{entry.plays}</b></div>)}{!users.length && <p className="empty-inline">{t("No activity yet. Take a test to join the board.")}</p>}</div><p className="leaderboard-privacy">{t("Only test counts are public. Scores stay private to each participant.")}</p></section>;
}

function AdminView({ users, onModerate, t }) {
  const totalTests = users.reduce((sum, item) => sum + Number(item.quiz_count), 0);
  return <section className="table-page"><div className="section-heading"><div><span className="eyebrow">{t("SYSTEM CONTROL")}</span><h1>{t("People in the studio.")}</h1></div><span className="admin-stamp"><Shield size={16} /> ADMIN</span></div><div className="admin-stats"><div><span>{t("REGISTERED USERS")}</span><strong>{users.length}</strong></div><div><span>{t("COMMUNITY TESTS")}</span><strong>{totalTests}</strong></div><div><span>{t("ACTIVE ACCOUNTS")}</span><strong>{users.filter(item => !item.is_banned).length}</strong></div></div><div className="admin-user-list">{users.map(item => <article className="admin-user" key={item.id}><Avatar className="comment-avatar" value={item.avatar} /><div className="admin-user-info"><strong>{item.username} {item.role === "admin" && <span className="role-tag">ADMIN</span>}</strong><span>{t("{tests} tests · {plays} plays · {warnings} warnings", { tests: item.quiz_count, plays: item.attempt_count, warnings: item.warning_count })}</span><small>{t("Last login: {date}", { date: item.last_login_at ? new Date(item.last_login_at).toLocaleString() : t("Never") })}</small></div><span className={`account-state ${item.is_banned ? "banned" : "active"}`}>{t(item.is_banned ? "Banned" : "Active")}</span>{item.role !== "admin" && <div className="admin-actions"><button className="icon-button" title={t("Warn user")} onClick={() => onModerate(item.id, "warn")}><Activity size={16} /></button><button className="icon-button" title={t(item.is_banned ? "Unban user" : "Ban user")} onClick={() => onModerate(item.id, item.is_banned ? "unban" : "ban")}>{item.is_banned ? <Check size={16} /> : <Ban size={16} />}</button></div>}</article>)}</div></section>;
}

function Avatar({ value, className }) {
  return <span className={className}>{value?.startsWith("data:image/") ? <img className="avatar-image" src={value} alt="" /> : value || "?"}</span>;
}

function SettingsView({ draft, setDraft, onSave, busy, t }) {
  const [photoError, setPhotoError] = useState("");

  function choosePhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      setPhotoError(t("Choose an image under 5 MB."));
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      const avatar = canvas.toDataURL("image/jpeg", 0.72);
      if (avatar.length > 200_000) {
        setPhotoError(t("Image is too large. Choose a smaller one."));
        return;
      }
      setPhotoError("");
      setDraft(current => ({ ...current, avatar }));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setPhotoError(t("Photo could not be loaded."));
    };
    image.src = objectUrl;
  }

  return (
    <section className="settings-page">
      <div className="section-heading"><div><span className="eyebrow">TESTSTUDIO / {t("Settings")}</span><h1>{t("Settings")}</h1></div></div>
      <form className="settings-form" onSubmit={onSave}>
        <section className="settings-section">
          <div><h2>{t("Theme")}</h2><p className="muted">{t("Choose how TestStudio looks for you.")}</p></div>
          <div className="segmented-control" role="group" aria-label={t("Theme")}>
            <button type="button" className={draft.theme === "light" ? "selected" : ""} aria-pressed={draft.theme === "light"} onClick={() => setDraft({ ...draft, theme: "light" })}><Sun size={16} /> {t("Light")}</button>
            <button type="button" className={draft.theme === "dark" ? "selected" : ""} aria-pressed={draft.theme === "dark"} onClick={() => setDraft({ ...draft, theme: "dark" })}><Moon size={16} /> {t("Dark")}</button>
          </div>
        </section>
        <section className="settings-section">
          <div><h2>{t("Language")}</h2><p className="muted">{t("Interface language")}</p></div>
          <select className="settings-select" value={draft.language} onChange={event => setDraft({ ...draft, language: event.target.value })} aria-label={t("Language")}>
            <option value="uz">O‘zbekcha</option><option value="ru">Русский</option><option value="en">English</option>
          </select>
        </section>
        <section className="settings-section profile-setting">
          <div><h2>{t("Profile photo")}</h2><p className="muted">{t("PNG, JPG or WebP · max 150 KB")}</p></div>
          <div className="photo-controls">
            <Avatar className="settings-avatar" value={draft.avatar} />
            <label className="button button-outline photo-picker"><ImagePlus size={16} /> {t("Choose photo")}<input type="file" accept="image/*" onChange={choosePhoto} /></label>
            {draft.avatar && <button type="button" className="text-button photo-remove" onClick={() => setDraft({ ...draft, avatar: "" })}>{t("Remove photo")}</button>}
          </div>
        </section>
        {photoError && <p className="form-error" role="alert">{photoError}</p>}
        <div className="settings-footer"><p className="muted">{t("Only your attempt result is shown to you.")}</p><button className="button button-dark" disabled={busy}>{busy ? t("Saving...") : t("Save settings")}</button></div>
      </form>
    </section>
  );
}

export default App;