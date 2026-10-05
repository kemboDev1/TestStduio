CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(32) NOT NULL,
    username_key VARCHAR(32) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(16) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    avatar TEXT NOT NULL DEFAULT '',
    theme VARCHAR(8) NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'dark')),
    language VARCHAR(2) NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'uz', 'ru')),
    is_banned BOOLEAN NOT NULL DEFAULT FALSE,
    warning_count INTEGER NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

ALTER TABLE users ALTER COLUMN avatar TYPE TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme VARCHAR(8) NOT NULL DEFAULT 'light';
ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(2) NOT NULL DEFAULT 'en';

CREATE TABLE IF NOT EXISTS quizzes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(120) NOT NULL,
    description VARCHAR(600) NOT NULL DEFAULT '',
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS quizzes_public_created_idx ON quizzes (is_public, created_at DESC);
CREATE INDEX IF NOT EXISTS quizzes_owner_idx ON quizzes (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS quiz_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    question_type VARCHAR(16) NOT NULL CHECK (question_type IN ('multiple', 'text')),
    prompt VARCHAR(600) NOT NULL,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    correct_option_index INTEGER,
    UNIQUE (quiz_id, position),
    CHECK (jsonb_typeof(options) = 'array')
);

CREATE TABLE IF NOT EXISTS attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0),
    total_scoreable INTEGER NOT NULL DEFAULT 0 CHECK (total_scoreable >= 0),
    is_practice BOOLEAN NOT NULL DEFAULT FALSE,
    answers JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (score <= total_scoreable)
);

ALTER TABLE attempts ADD COLUMN IF NOT EXISTS is_practice BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS attempts_user_idx ON attempts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS attempts_quiz_idx ON attempts (quiz_id, created_at DESC);

CREATE TABLE IF NOT EXISTS comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body VARCHAR(1200) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS comments_quiz_idx ON comments (quiz_id, created_at DESC);