CREATE TABLE enquiries (
  id INTEGER PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  firstName TEXT NOT NULL,
  lastName TEXT NOT NULL,
  email TEXT NOT NULL,
  destination TEXT NOT NULL DEFAULT '',
  journey TEXT NOT NULL DEFAULT '',
  departure TEXT NOT NULL DEFAULT '',
  travelers INTEGER NOT NULL CHECK(travelers BETWEEN 1 AND 12),
  budget TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','proposal','converted','closed')),
  createdAt TEXT NOT NULL
);
CREATE TABLE bookings (
  id INTEGER PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  enquiryId INTEGER UNIQUE REFERENCES enquiries(id),
  firstName TEXT NOT NULL,
  lastName TEXT NOT NULL,
  destination TEXT NOT NULL DEFAULT '',
  journey TEXT NOT NULL DEFAULT '',
  departure TEXT NOT NULL DEFAULT '',
  travelers INTEGER NOT NULL CHECK(travelers BETWEEN 1 AND 12),
  value INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planning' CHECK(status IN ('planning','confirmed','cancelled')),
  createdAt TEXT NOT NULL
);
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
