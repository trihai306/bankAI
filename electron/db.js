import Database from "better-sqlite3";
import path from "path";
import { app } from "electron";

let db;

// Current schema version — increment when adding migrations
const SCHEMA_VERSION = 1;

// Migration definitions: each entry runs once when upgrading from (version-1) to (version)
// Add new migrations at the end of this array
const MIGRATIONS = [
  // Version 1: baseline schema (runs only for brand new databases)
  // Existing databases that already have tables get version set to 1 automatically

  // --- Add future migrations below ---
  // {
  //   version: 2,
  //   description: "Add language column to voices",
  //   up: (db) => {
  //     db.exec(`ALTER TABLE voices ADD COLUMN language TEXT DEFAULT 'vi'`);
  //   },
  // },
];

function getSchemaVersion() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'schema_version'").get();
    return row ? parseInt(row.value, 10) : 0;
  } catch {
    // settings table might not exist yet
    return 0;
  }
}

function setSchemaVersion(version) {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
    "schema_version",
    String(version),
  );
}

function runMigrations() {
  const currentVersion = getSchemaVersion();

  if (currentVersion >= SCHEMA_VERSION) {
    console.log(`[DB] Schema is up to date (v${currentVersion})`);
    return;
  }

  // If tables already exist but no version tracked, set baseline
  if (currentVersion === 0) {
    const hasVoicesTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='voices'")
      .get();

    if (hasVoicesTable) {
      console.log("[DB] Existing database detected, setting baseline schema version to 1");
      setSchemaVersion(1);

      // Run only migrations above baseline
      const pendingMigrations = MIGRATIONS.filter((m) => m.version > 1);
      for (const migration of pendingMigrations) {
        console.log(`[DB] Running migration v${migration.version}: ${migration.description}`);
        migration.up(db);
      }
      setSchemaVersion(SCHEMA_VERSION);
      return;
    }
  }

  // Run pending migrations sequentially
  const pendingMigrations = MIGRATIONS.filter((m) => m.version > currentVersion);
  if (pendingMigrations.length > 0) {
    console.log(`[DB] Upgrading schema from v${currentVersion} to v${SCHEMA_VERSION} (${pendingMigrations.length} migration(s))`);

    for (const migration of pendingMigrations) {
      console.log(`[DB] Running migration v${migration.version}: ${migration.description}`);
      try {
        db.transaction(() => {
          migration.up(db);
          setSchemaVersion(migration.version);
        })();
        console.log(`[DB] Migration v${migration.version} completed`);
      } catch (err) {
        console.error(`[DB] Migration v${migration.version} FAILED:`, err.message);
        throw err;
      }
    }
  }
}

export function initDB() {
  const userDataPath = app.getPath("userData");
  const dbPath = path.join(userDataPath, "voice-bot.db");

  console.log("Initializing database at:", dbPath);

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  // Create tables (IF NOT EXISTS ensures safety for existing DBs)
  db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone_number TEXT,
            customer_name TEXT,
            start_time TEXT,
            duration TEXT,
            status TEXT,
            transcript TEXT,
            recording_path TEXT
        );

        CREATE TABLE IF NOT EXISTS models (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            type TEXT,
            status TEXT,
            params TEXT,
            context TEXT,
            size TEXT
        );

        CREATE TABLE IF NOT EXISTS voices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            audio_path TEXT NOT NULL,
            transcript TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
    `);

  // Run schema migrations
  runMigrations();

  // Set version for brand new databases
  if (getSchemaVersion() === 0) {
    setSchemaVersion(SCHEMA_VERSION);
  }

  // Initialize default settings only (no fake call data)
  const settingsCount = db
    .prepare("SELECT count(*) as count FROM settings WHERE key != 'schema_version'")
    .get().count;
  if (settingsCount === 0) {
    console.log("Initializing default settings...");
    const insertSetting = db.prepare(
      "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
    );
    insertSetting.run("voiceEngine", "vits");
    insertSetting.run("modelName", "Llama 3.2 8B");
    insertSetting.run("autoAnswer", "true");
    insertSetting.run("language", "vi-VN");
  }
}

// Database API
export const dbAPI = {
  // Dashboard Stats - Real data from database
  getDashboardStats: () => {
    const today = new Date().toISOString().split("T")[0];

    const totalCalls = db
      .prepare("SELECT count(*) as count FROM calls")
      .get().count;
    const todayCalls = db
      .prepare("SELECT count(*) as count FROM calls WHERE start_time LIKE ?")
      .get(`${today}%`).count;
    const completedCalls = db
      .prepare("SELECT count(*) as count FROM calls WHERE status = ?")
      .get("completed").count;

    // Calculate real success rate
    const successRate =
      totalCalls > 0
        ? Math.round((completedCalls / totalCalls) * 100 * 10) / 10
        : 0;

    // Calculate average duration from actual calls
    const allCalls = db
      .prepare("SELECT duration FROM calls WHERE duration IS NOT NULL")
      .all();
    let avgDuration = "0:00";
    if (allCalls.length > 0) {
      let totalSeconds = 0;
      allCalls.forEach((call) => {
        if (call.duration) {
          const parts = call.duration.split(":");
          totalSeconds +=
            parseInt(parts[0] || 0) * 60 + parseInt(parts[1] || 0);
        }
      });
      const avgSeconds = Math.round(totalSeconds / allCalls.length);
      const mins = Math.floor(avgSeconds / 60);
      const secs = avgSeconds % 60;
      avgDuration = `${mins}:${secs.toString().padStart(2, "0")}`;
    }

    return {
      totalCalls,
      todayCalls,
      successRate,
      avgDuration,
    };
  },

  // Calls
  getRecentCalls: (limit = 5) => {
    return db
      .prepare("SELECT * FROM calls ORDER BY start_time DESC LIMIT ?")
      .all(limit);
  },

  getAllCalls: () => {
    return db.prepare("SELECT * FROM calls ORDER BY start_time DESC").all();
  },

  // Add a new call record
  addCall: (callData) => {
    const stmt = db.prepare(`
            INSERT INTO calls (phone_number, customer_name, start_time, duration, status, transcript, recording_path) 
            VALUES (@phone_number, @customer_name, @start_time, @duration, @status, @transcript, @recording_path)
        `);
    return stmt.run(callData);
  },

  // Settings
  getSettings: () => {
    const rows = db.prepare("SELECT * FROM settings").all();
    const settings = {};
    rows.forEach((row) => {
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch {
        settings[row.key] =
          row.value === "true"
            ? true
            : row.value === "false"
              ? false
              : row.value;
      }
    });
    return settings;
  },

  saveSetting: (key, value) => {
    const strValue =
      typeof value === "object" ? JSON.stringify(value) : String(value);
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    ).run(key, strValue);
    return true;
  },

  // Clear all call data (for testing)
  clearCalls: () => {
    db.prepare("DELETE FROM calls").run();
    return true;
  },

  // Voices CRUD
  getVoices: () => {
    return db.prepare("SELECT * FROM voices ORDER BY created_at DESC").all();
  },

  getVoice: (id) => {
    return db.prepare("SELECT * FROM voices WHERE id = ?").get(id);
  },

  createVoice: ({ name, audio_path, transcript }) => {
    const stmt = db.prepare(
      "INSERT INTO voices (name, audio_path, transcript) VALUES (?, ?, ?)",
    );
    const result = stmt.run(name, audio_path, transcript || "");
    return { id: result.lastInsertRowid, name, audio_path, transcript };
  },

  updateVoice: (id, { name, transcript, audio_path }) => {
    const fields = [];
    const values = [];
    if (name !== undefined) {
      fields.push("name = ?");
      values.push(name);
    }
    if (transcript !== undefined) {
      fields.push("transcript = ?");
      values.push(transcript);
    }
    if (audio_path !== undefined) {
      fields.push("audio_path = ?");
      values.push(audio_path);
    }
    if (fields.length === 0) return false;
    fields.push("updated_at = datetime('now', 'localtime')");
    values.push(id);
    db.prepare(`UPDATE voices SET ${fields.join(", ")} WHERE id = ?`).run(
      ...values,
    );
    return true;
  },

  deleteVoice: (id) => {
    db.prepare("DELETE FROM voices WHERE id = ?").run(id);
    return true;
  },
};
