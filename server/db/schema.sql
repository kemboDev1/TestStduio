CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(32) NOT NULL,
    first_name VARCHAR(60) NOT NULL DEFAULT '',
    last_name VARCHAR(60) NOT NULL DEFAULT '',
    gender VARCHAR(8) NOT NULL DEFAULT 'female' CHECK (gender IN ('male', 'female')),
    username_key VARCHAR(32) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(16) NOT NULL DEFAULT 'tester',
    avatar TEXT NOT NULL DEFAULT '',
    theme VARCHAR(8) NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'dark')),
    language VARCHAR(2) NOT NULL DEFAULT 'uz' CHECK (language IN ('en', 'uz', 'ru')),
    text_size VARCHAR(8) NOT NULL DEFAULT 'medium' CHECK (text_size IN ('small', 'medium', 'large')),
    suspended_until TIMESTAMPTZ,
    is_banned BOOLEAN NOT NULL DEFAULT FALSE,
    warning_count INTEGER NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE users SET role = 'tester' WHERE role = 'user';
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'tester';
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('tester', 'creator', 'admin'));

ALTER TABLE users ALTER COLUMN avatar TYPE TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme VARCHAR(8) NOT NULL DEFAULT 'light';
ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(2) NOT NULL DEFAULT 'uz';
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(60) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(60) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender VARCHAR(8) NOT NULL DEFAULT 'female';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_gender_check;
ALTER TABLE users ADD CONSTRAINT users_gender_check CHECK (gender IN ('male', 'female'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS text_size VARCHAR(8) NOT NULL DEFAULT 'medium';
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ;

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

CREATE TABLE IF NOT EXISTS groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500) NOT NULL DEFAULT '',
    gender_rule VARCHAR(8) NOT NULL DEFAULT 'all' CHECK (gender_rule IN ('all', 'female', 'male')),
    invite_code VARCHAR(32) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS groups_owner_idx ON groups (owner_id, created_at DESC);

ALTER TABLE groups ADD COLUMN IF NOT EXISTS gender_rule VARCHAR(8) NOT NULL DEFAULT 'all';
ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_gender_rule_check;
ALTER TABLE groups ADD CONSTRAINT groups_gender_rule_check CHECK (gender_rule IN ('all', 'female', 'male'));

CREATE TABLE IF NOT EXISTS group_members (
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    member_role VARCHAR(16) NOT NULL DEFAULT 'tester' CHECK (member_role IN ('creator', 'tester')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS group_members_user_idx ON group_members (user_id, joined_at DESC);

ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES groups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS quizzes_group_idx ON quizzes (group_id, created_at DESC);

CREATE TABLE IF NOT EXISTS quiz_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    question_type VARCHAR(16) NOT NULL CHECK (question_type IN ('multiple', 'text', 'scale')),
    prompt VARCHAR(600) NOT NULL,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    correct_option_index INTEGER,
    UNIQUE (quiz_id, position),
    CHECK (jsonb_typeof(options) = 'array')
);

ALTER TABLE quiz_questions DROP CONSTRAINT IF EXISTS quiz_questions_question_type_check;
ALTER TABLE quiz_questions ADD CONSTRAINT quiz_questions_question_type_check CHECK (question_type IN ('multiple', 'text', 'scale'));

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
