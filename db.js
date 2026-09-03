const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "sortit.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  location TEXT NOT NULL,
  date TEXT,
  ongoing INTEGER NOT NULL DEFAULT 0,
  name TEXT,
  phone TEXT,
  evidence TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'Reported',
  votes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS issue_votes (
  issue_id INTEGER NOT NULL,
  voter_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (issue_id, voter_id),
  FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS poll_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id INTEGER NOT NULL,
  option_text TEXT NOT NULL,
  base_votes INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id INTEGER NOT NULL,
  voter_id TEXT NOT NULL,
  option_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (poll_id, voter_id),
  FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE,
  FOREIGN KEY (option_id) REFERENCES poll_options(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

const pollCount = db.prepare("SELECT COUNT(*) AS count FROM polls").get().count;
if (pollCount === 0) {
  const insertPoll = db.prepare("INSERT INTO polls (question) VALUES (?)");
  const insertOption = db.prepare("INSERT INTO poll_options (poll_id, option_text, base_votes) VALUES (?, ?, ?)");
  const create = db.transaction(() => {
    const poll = insertPoll.run("What is the biggest problem in your area?");
    // New installs start at zero. Existing demo poll seed data is deliberately not added.
    for (const text of ["Poor Roads", "Water Supply", "Drainage", "Garbage / Cleanliness", "Other"]) {
      insertOption.run(poll.lastInsertRowid, text, 0);
    }
  });
  create();
}

function getPolls() {
  const polls = db.prepare("SELECT * FROM polls ORDER BY id").all();
  const options = db.prepare(`
    SELECT po.*, COALESCE(SUM(CASE WHEN pv.option_id = po.id THEN 1 ELSE 0 END), 0) AS live_votes
    FROM poll_options po
    LEFT JOIN poll_votes pv ON pv.option_id = po.id
    GROUP BY po.id
    ORDER BY po.id
  `).all();
  return polls.map(poll => {
    const pollOptions = options.filter(o => o.poll_id === poll.id);
    const total = pollOptions.reduce((sum, o) => sum + o.base_votes + o.live_votes, 0);
    return {
      id: poll.id,
      question: poll.question,
      total,
      options: pollOptions.map(o => ({ id:o.id, text:o.option_text, votes:o.base_votes + o.live_votes }))
    };
  });
}

function voteIssue(issueId, voterId) {
  const issue = db.prepare("SELECT id, votes FROM issues WHERE id = ?").get(issueId);
  if (!issue) { const e = new Error("NOT_FOUND"); e.code = "NOT_FOUND"; throw e; }
  try {
    db.transaction(() => {
      db.prepare("INSERT INTO issue_votes (issue_id, voter_id) VALUES (?, ?)").run(issueId, voterId);
      db.prepare("UPDATE issues SET votes = votes + 1 WHERE id = ?").run(issueId);
    })();
  } catch (e) {
    if (String(e.message).includes("UNIQUE constraint failed")) {
      const err = new Error("ALREADY_VOTED"); err.code = "ALREADY_VOTED"; throw err;
    }
    throw e;
  }
  return { ok:true, votes:db.prepare("SELECT votes FROM issues WHERE id = ?").get(issueId).votes };
}

function votePoll(pollId, optionIndex, voterId) {
  const poll = getPolls().find(p => p.id === pollId);
  if (!poll || !poll.options[optionIndex]) {
    const e = new Error("NOT_FOUND"); e.code = "NOT_FOUND"; throw e;
  }
  const optionId = poll.options[optionIndex].id;
  const existing = db.prepare("SELECT option_id FROM poll_votes WHERE poll_id = ? AND voter_id = ?").get(pollId, voterId);
  if (existing) {
    db.prepare("UPDATE poll_votes SET option_id = ?, created_at = CURRENT_TIMESTAMP WHERE poll_id = ? AND voter_id = ?")
      .run(optionId, pollId, voterId);
  } else {
    db.prepare("INSERT INTO poll_votes (poll_id, voter_id, option_id) VALUES (?, ?, ?)")
      .run(pollId, voterId, optionId);
  }
  return { ok:true, changed:Boolean(existing), polls:getPolls() };
}

function getStats() {
  const reported = db.prepare("SELECT COUNT(*) AS count FROM issues").get().count;
  const voters = db.prepare("SELECT COUNT(DISTINCT voter_id) AS count FROM (SELECT voter_id FROM issue_votes UNION SELECT voter_id FROM poll_votes)").get().count;
  const resolved = db.prepare("SELECT COUNT(*) AS count FROM issues WHERE status = 'Resolved'").get().count;
  const cities = db.prepare("SELECT COUNT(DISTINCT location) AS count FROM issues").get().count;
  const votes = db.prepare("SELECT COUNT(*) AS count FROM issue_votes").get().count +
                db.prepare("SELECT COUNT(*) AS count FROM poll_votes").get().count;
  return { issuesReported:reported, activeVoters:voters, issuesResolved:resolved, citiesCovered:cities, votesCast:votes };
}

function getUserByEmail(email) {
  return db.prepare("SELECT id, name, email, password_hash FROM users WHERE email = ?").get(email);
}
function createUser(name,email,passwordHash) {
  return db.prepare("INSERT INTO users (name,email,password_hash) VALUES (?,?,?)").run(name,email,passwordHash);
}
function getUserById(id) {
  return db.prepare("SELECT id,name,email FROM users WHERE id = ?").get(id);
}
function createSession(token,userId) {
  db.prepare("INSERT INTO sessions (token,user_id) VALUES (?,?)").run(token,userId);
}
function getUserBySession(token) {
  return db.prepare("SELECT u.id,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?").get(token);
}
function deleteSession(token) { db.prepare("DELETE FROM sessions WHERE token=?").run(token); }

module.exports = {
  prepare:(...args)=>db.prepare(...args),
  voteIssue, votePoll, getPolls, getStats,
  getUserByEmail, createUser, getUserById, createSession, getUserBySession, deleteSession
};
