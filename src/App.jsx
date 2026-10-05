import { useEffect, useState } from "react";
import {
  Activity, ArrowLeft, ArrowUpRight, BadgeCheck, Ban, BookOpen,
  Check, ChevronRight, CircleHelp, Clock3, LogOut, MessageCircle,
  Plus, Send, Shield, Sparkles, Trophy, Users, WandSparkles
} from "lucide-react";
import { api, jsonBody } from "./api.js";

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

  useEffect(() => {
    api("/auth/me")
      .then(payload => setUser(payload.user))
      .catch(error => setNotice(error.message))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!user) return;
    api("/quizzes").then(payload => setQuizzes(payload.quizzes)).catch(error => setNotice(error.message));
    api("/leaderboard").then(payload => setLeaderboard(payload.users)).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (view !== "admin" || user?.role !== "admin") return;
    api("/admin/users").then(payload => setAdminUsers(payload.users)).catch(error => setNotice(error.message));
  }, [view, user]);

  function announce(message) {
    setNotice(message);
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
      announce(payload.provider === "ai" ? "AI savollar tayyor." : "Offline savol generatori ishladi. AI API key qo'shilsa, generativ model ishlaydi.");
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
      announce("Test hamma uchun e'lon qilindi.");
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
      announce(`Natija: ${payload.attempt.score}/${payload.attempt.total_scoreable}`);
      api("/leaderboard").then(data => setLeaderboard(data.users)).catch(() => {});
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
      announce("Feedback test egasiga yuborildi.");
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
      announce(action === "warn" ? "Ogohlantirish qo'shildi." : action === "ban" ? "Account bloklandi." : "Account qayta faollashtirildi.");
    } catch (error) {
      announce(error.message);
    }
  }

  if (!ready) return <div className="boot-screen"><span className="boot-mark">TS</span><p>TestStudio yuklanmoqda</p></div>;
  if (!user) {
    return <AuthScreen mode={authMode} setMode={setAuthMode} form={authForm} setForm={setAuthForm} onSubmit={submitAuth} busy={busy} notice={notice} />;
  }

  return (
    <div className="studio-app">
      <header className="topbar">
        <a className="brand" href="#discover" onClick={event => { event.preventDefault(); setView("discover"); }}>
          <span className="brand-mark">TS</span><span>test<span className="brand-light">studio</span></span>
        </a>
        <nav className="main-nav" aria-label="Asosiy navigatsiya">
          <NavButton active={view === "discover"} onClick={() => setView("discover")} icon={<BookOpen size={16} />}>Discover</NavButton>
          <NavButton active={view === "builder"} onClick={() => setView("builder")} icon={<Plus size={16} />}>Studio</NavButton>
          <NavButton active={view === "leaderboard"} onClick={() => setView("leaderboard")} icon={<Trophy size={16} />}>Leaderboard</NavButton>
          {user.role === "admin" && <NavButton active={view === "admin"} onClick={() => setView("admin")} icon={<Shield size={16} />}>Admin</NavButton>}
        </nav>
        <div className="account-tools">
          <span className="account-avatar">{user.avatar}</span>
          <span className="account-name">{user.username}</span>
          {user.role === "admin" && <span className="role-tag">ADMIN</span>}
          <button className="icon-button" onClick={signOut} title="Chiqish" aria-label="Chiqish"><LogOut size={17} /></button>
        </div>
      </header>

      {notice && <div className="notice-bar" role="status"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Yopish">×</button></div>}

      <main className="page-shell">
        {view === "discover" && <DiscoverView quizzes={quizzes} user={user} onOpen={openQuiz} onCreate={() => setView("builder")} busy={busy} />}
        {view === "builder" && <BuilderView draft={draft} setDraft={setDraft} updateQuestion={updateQuestion} onPublish={publishQuiz} busy={busy} aiTopic={aiTopic} setAiTopic={setAiTopic} aiCount={aiCount} setAiCount={setAiCount} onAi={generateWithAi} aiProvider={aiProvider} />}
        {view === "play" && selectedQuiz && <PlayView quizData={selectedQuiz} user={user} answers={answers} setAnswers={setAnswers} attempt={attempt} onSubmit={submitAttempt} comments={comments} feedback={feedback} setFeedback={setFeedback} onFeedback={sendFeedback} onBack={() => setView("discover")} busy={busy} />}
        {view === "leaderboard" && <LeaderboardView users={leaderboard} />}
        {view === "admin" && user.role === "admin" && <AdminView users={adminUsers} onModerate={moderate} />}
      </main>
      <footer className="site-footer"><span>TESTSTUDIO</span><span>Made for questions worth sharing.</span><span><Activity size={14} /> Connected workspace</span></footer>
    </div>
  );
}

function AuthScreen({ mode, setMode, form, setForm, onSubmit, busy, notice }) {
  const registering = mode === "register";
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <a className="brand auth-brand" href="/"><span className="brand-mark">TS</span><span>test<span className="brand-light">studio</span></span></a>
        <div className="auth-story-copy">
          <span className="eyebrow"><Sparkles size={14} /> COMMUNITY QUIZ STUDIO</span>
          <h1>Good questions<br /><em>travel further.</em></h1>
          <p>Build a test, share it with everyone, and get feedback from the people who take it.</p>
        </div>
        <div className="auth-stats"><span><strong>01</strong> Make a test</span><span><strong>02</strong> Share it</span><span><strong>03</strong> Learn together</span></div>
      </section>
      <section className="auth-card-wrap">
        <form className="auth-card" onSubmit={onSubmit}>
          <div className="form-kicker">YOUR STUDIO</div>
          <h2>{registering ? "Create your account" : "Welcome back"}</h2>
          <p className="muted">{registering ? "A name and password are all you need to begin." : "Sign in to your TestStudio account."}</p>
          <label>Display name<input autoComplete="username" minLength="2" maxLength="32" value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} required placeholder="e.g. Samira" /></label>
          <label>Password<input autoComplete={registering ? "new-password" : "current-password"} type="password" minLength={registering ? 8 : 1} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} required placeholder={registering ? "At least 8 characters" : "Your password"} /></label>
          {notice && <p className="form-error" role="alert">{notice}</p>}
          <button className="button button-dark full-button" disabled={busy}>{busy ? "Please wait..." : registering ? "Create account" : "Sign in"}<ArrowUpRight size={17} /></button>
          <button type="button" className="text-button" onClick={() => setMode(registering ? "login" : "register")}>
            {registering ? "Already have an account? Sign in" : "New here? Create an account"}
          </button>
          <p className="privacy-note"><Shield size={13} /> Passwords are securely hashed. Your tests are stored in the shared database.</p>
        </form>
      </section>
    </main>
  );
}

function NavButton({ active, onClick, icon, children }) {
  return <button className={`nav-button ${active ? "is-active" : ""}`} onClick={onClick}>{icon}{children}</button>;
}

function DiscoverView({ quizzes, user, onOpen, onCreate, busy }) {
  const ownCount = quizzes.filter(quiz => quiz.owner_id === user.id).length;
  return (
    <>
      <section className="welcome-band">
        <div className="welcome-copy"><span className="eyebrow">THE QUESTION EXCHANGE · 2026</span><h1>Ideas become<br /><em>better questions.</em></h1><p>Explore community-made tests, or publish one of your own.</p><button className="button button-dark" onClick={onCreate}>Create a test <ArrowUpRight size={16} /></button></div>
        <div className="welcome-aside"><div className="orbit-stamp"><CircleHelp size={42} strokeWidth={1.2} /><span>ASK<br />MORE</span></div><div className="welcome-number">{quizzes.length.toString().padStart(2, "0")}<small>PUBLIC TESTS</small></div></div>
      </section>
      <div className="section-heading"><div><span className="eyebrow">OPEN TO EVERYONE</span><h2>Community tests</h2></div><span className="section-meta">{ownCount} by you <span>/</span> {quizzes.length} total</span></div>
      {quizzes.length ? <div className="quiz-grid">{quizzes.map((quiz, index) => <QuizCard key={quiz.id} quiz={quiz} index={index} onClick={() => onOpen(quiz)} busy={busy} />)}</div> : <div className="empty-state"><BookOpen size={24} /><h3>First question is yours.</h3><p>No tests have been published yet.</p><button className="button button-outline" onClick={onCreate}>Build the first test <ArrowUpRight size={16} /></button></div>}
    </>
  );
}

function QuizCard({ quiz, index, onClick, busy }) {
  const accent = ["mint", "peach", "lemon", "lilac"][index % 4];
  return (
    <article className={`quiz-card accent-${accent}`}>
      <div className="quiz-card-top"><span className="question-count">{String(quiz.question_count).padStart(2, "0")} QUESTIONS</span><span className="quiz-index">{String(index + 1).padStart(2, "0")}</span></div>
      <h3>{quiz.title}</h3><p>{quiz.description || "A community quiz waiting to be explored."}</p>
      <div className="quiz-card-footer"><span><span className="owner-dot">{quiz.owner_name?.[0]?.toUpperCase()}</span> {quiz.owner_name}</span><span><MessageCircle size={14} /> {quiz.comment_count}</span></div>
      <button className="card-open" disabled={busy} onClick={onClick} aria-label={`Open ${quiz.title}`}><ArrowUpRight size={18} /></button>
    </article>
  );
}

function BuilderView({ draft, setDraft, updateQuestion, onPublish, busy, aiTopic, setAiTopic, aiCount, setAiCount, onAi, aiProvider }) {
  function updateOption(questionIndex, optionIndex, value) {
    const question = draft.questions[questionIndex];
    updateQuestion(questionIndex, { options: question.options.map((option, index) => index === optionIndex ? value : option) });
  }
  function changeType(index, type) {
    updateQuestion(index, { type, options: type === "multiple" ? ["", "", "", ""] : [], correctOptionIndex: 0 });
  }
  return (
    <section className="builder-page">
      <button className="back-link" onClick={() => window.history.back()}><ArrowLeft size={15} /> Back to tests</button>
      <div className="builder-heading"><div><span className="eyebrow">TESTSTUDIO / EDITOR</span><h1>Build your next<br /><em>great question.</em></h1></div><span className="draft-label">DRAFT · {draft.questions.length} QUESTIONS</span></div>
      <div className="builder-layout">
        <form className="builder-form" onSubmit={onPublish}>
          <label>Test title<input required minLength="2" maxLength="120" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder="What will people learn?" /></label>
          <label>Short description<textarea maxLength="600" value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} placeholder="Set the scene for your test" rows="3" /></label>
          <div className="question-stack">
            {draft.questions.map((question, index) => <div className="editor-question" key={index}>
              <div className="editor-question-top"><span>QUESTION {String(index + 1).padStart(2, "0")}</span><select value={question.type} onChange={event => changeType(index, event.target.value)}><option value="multiple">Multiple choice</option><option value="text">Open answer</option></select></div>
              <textarea required value={question.prompt} onChange={event => updateQuestion(index, { prompt: event.target.value })} maxLength="600" placeholder="Write a clear, interesting question..." rows="2" />
              {question.type === "multiple" && <div className="option-list">{question.options.map((option, optionIndex) => <label className="option-editor" key={optionIndex}><input type="radio" name={`correct-${index}`} checked={question.correctOptionIndex === optionIndex} onChange={() => updateQuestion(index, { correctOptionIndex: optionIndex })} aria-label={`Set answer ${optionIndex + 1} as correct`} /><input value={option} onChange={event => updateOption(index, optionIndex, event.target.value)} required placeholder={`Answer ${optionIndex + 1}`} /></label>)}</div>}
              {draft.questions.length > 1 && <button type="button" className="remove-question" onClick={() => setDraft({ ...draft, questions: draft.questions.filter((_, questionIndex) => questionIndex !== index) })}>Remove question</button>}
            </div>)}
          </div>
          <div className="builder-actions"><button type="button" className="button button-outline" onClick={() => setDraft({ ...draft, questions: [...draft.questions, blankQuestion()] })}><Plus size={16} /> Add question</button><button disabled={busy} className="button button-dark">{busy ? "Publishing..." : "Publish test"}<ArrowUpRight size={16} /></button></div>
        </form>
        <aside className="ai-panel">
          <div className="ai-panel-top"><span className="ai-icon"><WandSparkles size={19} /></span><span className="ai-status"><span /> STUDIO AI</span></div>
          <h2>Skip the blank page.</h2><p>Give the assistant a topic. It will draft varied questions and answer choices for you to edit.</p>
          <label>Describe your quiz topic<input value={aiTopic} onChange={event => setAiTopic(event.target.value)} maxLength="500" placeholder="e.g. Oila haqida: mehr, qadriyatlar va muloqot" /></label>
          <label>Questions<select value={aiCount} onChange={event => setAiCount(event.target.value)}>{[3, 5, 7, 10].map(count => <option key={count} value={count}>{count} questions</option>)}</select></label>
          <button className="button button-acid full-button" onClick={onAi} disabled={busy || aiTopic.trim().length < 2}><Sparkles size={16} /> {busy ? "Thinking..." : "Generate questions"}</button>
          {aiProvider && <p className="provider-note">{aiProvider === "ai" ? "Generated with your configured AI provider." : "Offline starter set. Add AI_API_KEY in .env for generative questions."}</p>}
          <div className="ai-footnote"><BadgeCheck size={14} /> Review every answer before publishing.</div>
        </aside>
      </div>
    </section>
  );
}

function PlayView({ quizData, user, answers, setAnswers, attempt, onSubmit, comments, feedback, setFeedback, onFeedback, onBack, busy }) {
  const { quiz, questions } = quizData;
  const isOwner = quiz.owner_id === user.id;
  return (
    <section className="play-page">
      <button className="back-link" onClick={onBack}><ArrowLeft size={15} /> All tests</button>
      <div className="play-hero"><span className="eyebrow">BY {quiz.owner_name?.toUpperCase()}</span><h1>{quiz.title}</h1><p>{quiz.description}</p><div className="play-meta"><span><CircleHelp size={15} /> {questions.length} questions</span><span><MessageCircle size={15} /> {comments.length} feedback notes</span></div></div>
      {attempt && <div className="score-banner"><span><Trophy size={20} /> Your score</span><strong>{attempt.score}<small> / {attempt.total_scoreable}</small></strong></div>}
      <form onSubmit={onSubmit} className="play-questions">
        {questions.map((question, index) => <article className="play-question" key={question.id}><div className="question-number">{String(index + 1).padStart(2, "0")}</div><div className="question-body"><h2>{question.prompt}</h2>{question.type === "text" ? <textarea rows="3" disabled={Boolean(attempt)} value={answers[question.id] || ""} onChange={event => setAnswers({ ...answers, [question.id]: event.target.value })} placeholder="Write your answer..." /> : <div className="play-options">{question.options.map((option, optionIndex) => <label className={`play-option ${answers[question.id] === optionIndex ? "selected" : ""} ${attempt && question.correct_option_index === optionIndex ? "is-correct" : ""}`} key={optionIndex}><input type="radio" name={question.id} disabled={Boolean(attempt)} checked={answers[question.id] === optionIndex} onChange={() => setAnswers({ ...answers, [question.id]: optionIndex })} /><span>{option}</span>{attempt && question.correct_option_index === optionIndex && <Check size={16} />}</label>)}</div>}</div></article>)}
        {!attempt && <button className="button button-dark" disabled={busy || isOwner}>{isOwner ? "Preview only · owner cannot score own test" : "Submit answers"}<ArrowUpRight size={16} /></button>}
      </form>
      <section className="feedback-section"><div className="section-heading"><div><span className="eyebrow">AFTER THE TEST</span><h2>Feedback to the creator</h2></div></div>
        {!isOwner && attempt && <form className="feedback-form" onSubmit={onFeedback}><textarea value={feedback} onChange={event => setFeedback(event.target.value)} maxLength="1200" rows="2" placeholder="What worked well? What could be clearer?" required /><button className="button button-dark" disabled={busy}><Send size={15} /> Send feedback</button></form>}
        {!isOwner && !attempt && <p className="muted feedback-gate">Complete the test to leave a note for its creator.</p>}
        <div className="comment-list">{comments.map(comment => <article className="comment" key={comment.id}><div className="comment-avatar">{comment.author_name?.[0]?.toUpperCase()}</div><div><div className="comment-meta"><strong>{comment.author_name}</strong><time>{new Date(comment.created_at).toLocaleString()}</time></div><p>{comment.body}</p></div></article>)}{!comments.length && <p className="muted">No feedback yet.</p>}</div>
      </section>
    </section>
  );
}

function LeaderboardView({ users }) {
  return <section className="table-page"><div className="section-heading"><div><span className="eyebrow">COMMUNITY SCORES</span><h1>Leaderboard</h1></div><span className="section-meta"><Users size={15} /> {users.length} players</span></div><div className="leaderboard-table"><div className="table-head"><span>RANK</span><span>PLAYER</span><span>PLAYS</span><span>BEST</span><span>TOTAL</span></div>{users.map((entry, index) => <div className={`leader-row ${index === 0 ? "top-player" : ""}`} key={entry.id}><span className="rank-number">{String(index + 1).padStart(2, "0")}</span><strong><span className="account-avatar">{entry.avatar}</span>{entry.username}</strong><span>{entry.plays}</span><span>{entry.best_score}</span><b>{entry.total_score}</b></div>)}{!users.length && <p className="empty-inline">No scores yet. Take a test to join the board.</p>}</div></section>;
}

function AdminView({ users, onModerate }) {
  const totalTests = users.reduce((sum, item) => sum + Number(item.quiz_count), 0);
  return <section className="table-page"><div className="section-heading"><div><span className="eyebrow">SYSTEM CONTROL</span><h1>People in the studio.</h1></div><span className="admin-stamp"><Shield size={16} /> ADMIN</span></div><div className="admin-stats"><div><span>REGISTERED USERS</span><strong>{users.length}</strong></div><div><span>COMMUNITY TESTS</span><strong>{totalTests}</strong></div><div><span>ACTIVE ACCOUNTS</span><strong>{users.filter(item => !item.is_banned).length}</strong></div></div><div className="admin-user-list">{users.map(item => <article className="admin-user" key={item.id}><div className="comment-avatar">{item.avatar}</div><div className="admin-user-info"><strong>{item.username} {item.role === "admin" && <span className="role-tag">ADMIN</span>}</strong><span>{item.quiz_count} tests · {item.attempt_count} plays · {item.warning_count} warnings</span><small>Last login: {item.last_login_at ? new Date(item.last_login_at).toLocaleString() : "Never"}</small></div><span className={`account-state ${item.is_banned ? "banned" : "active"}`}>{item.is_banned ? "Banned" : "Active"}</span>{item.role !== "admin" && <div className="admin-actions"><button className="icon-button" title="Warn user" onClick={() => onModerate(item.id, "warn")}><Activity size={16} /></button><button className="icon-button" title={item.is_banned ? "Unban user" : "Ban user"} onClick={() => onModerate(item.id, item.is_banned ? "unban" : "ban")}>{item.is_banned ? <Check size={16} /> : <Ban size={16} />}</button></div>}</article>)}</div></section>;
}

export default App;