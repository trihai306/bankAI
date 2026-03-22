import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';

let db;

export function initDB() {
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'voice-bot.db');

    console.log('Initializing database at:', dbPath);

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    // Create tables
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

        CREATE TABLE IF NOT EXISTS voice_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            ref_audio_path TEXT,
            transcript TEXT,
            quality_score INTEGER DEFAULT 0,
            quality_details TEXT,
            samples_count INTEGER DEFAULT 0,
            total_duration REAL DEFAULT 0,
            is_trained INTEGER DEFAULT 0,
            model_path TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            is_active INTEGER DEFAULT 0
        );
    `);

    // Initialize default settings only (no fake call data)
    const settingsCount = db.prepare('SELECT count(*) as count FROM settings').get().count;
    if (settingsCount === 0) {
        console.log('Initializing default settings...');
        const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
        insertSetting.run('voiceEngine', 'vits');
        insertSetting.run('modelName', 'Llama 3.2 8B');
        insertSetting.run('autoAnswer', 'true');
        insertSetting.run('language', 'vi-VN');
    }
}

// Database API
export const dbAPI = {
    // Dashboard Stats - Real data from database
    getDashboardStats: () => {
        const today = new Date().toISOString().split('T')[0];

        const totalCalls = db.prepare('SELECT count(*) as count FROM calls').get().count;
        const todayCalls = db.prepare('SELECT count(*) as count FROM calls WHERE start_time LIKE ?').get(`${today}%`).count;
        const completedCalls = db.prepare('SELECT count(*) as count FROM calls WHERE status = ?').get('completed').count;

        // Calculate real success rate
        const successRate = totalCalls > 0 ? Math.round((completedCalls / totalCalls) * 100 * 10) / 10 : 0;

        // Calculate average duration from actual calls
        const allCalls = db.prepare('SELECT duration FROM calls WHERE duration IS NOT NULL').all();
        let avgDuration = '0:00';
        if (allCalls.length > 0) {
            let totalSeconds = 0;
            allCalls.forEach(call => {
                if (call.duration) {
                    const parts = call.duration.split(':');
                    totalSeconds += parseInt(parts[0] || 0) * 60 + parseInt(parts[1] || 0);
                }
            });
            const avgSeconds = Math.round(totalSeconds / allCalls.length);
            const mins = Math.floor(avgSeconds / 60);
            const secs = avgSeconds % 60;
            avgDuration = `${mins}:${secs.toString().padStart(2, '0')}`;
        }

        return {
            totalCalls,
            todayCalls,
            successRate,
            avgDuration
        };
    },

    // Calls  
    getRecentCalls: (limit = 5) => {
        return db.prepare('SELECT * FROM calls ORDER BY start_time DESC LIMIT ?').all(limit);
    },

    getAllCalls: () => {
        return db.prepare('SELECT * FROM calls ORDER BY start_time DESC').all();
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
        const rows = db.prepare('SELECT * FROM settings').all();
        const settings = {};
        rows.forEach(row => {
            try {
                settings[row.key] = JSON.parse(row.value);
            } catch {
                settings[row.key] = row.value === 'true' ? true : row.value === 'false' ? false : row.value;
            }
        });
        return settings;
    },

    saveSetting: (key, value) => {
        const ALLOWED_KEYS = ['voiceEngine', 'modelName', 'autoAnswer', 'language', 'ollamaUrl', 'ttsServer', 'theme', 'volume', 'sttModel', 'maxCallDuration'];
        if (!ALLOWED_KEYS.includes(key)) {
            return { success: false, error: `Setting key "${key}" is not allowed` };
        }
        const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, strValue);
        return true;
    },

    // Clear all call data (for testing)
    clearCalls: () => {
        db.prepare('DELETE FROM calls').run();
        return true;
    },

    // Voice Profiles
    createProfile: (data) => {
        const stmt = db.prepare(`
            INSERT INTO voice_profiles (name, ref_audio_path, transcript, quality_score, quality_details, samples_count, total_duration, is_trained, model_path)
            VALUES (@name, @ref_audio_path, @transcript, @quality_score, @quality_details, @samples_count, @total_duration, @is_trained, @model_path)
        `);
        const result = stmt.run({
            name: data.name || 'Untitled',
            ref_audio_path: data.ref_audio_path || null,
            transcript: data.transcript || null,
            quality_score: data.quality_score || 0,
            quality_details: data.quality_details || null,
            samples_count: data.samples_count || 0,
            total_duration: data.total_duration || 0,
            is_trained: data.is_trained || 0,
            model_path: data.model_path || null,
        });
        return { id: result.lastInsertRowid, ...data };
    },

    getProfiles: () => {
        return db.prepare('SELECT * FROM voice_profiles ORDER BY created_at DESC').all();
    },

    getProfile: (id) => {
        return db.prepare('SELECT * FROM voice_profiles WHERE id = ?').get(id);
    },

    getActiveProfile: () => {
        return db.prepare('SELECT * FROM voice_profiles WHERE is_active = 1').get() || null;
    },

    setActiveProfile: (id) => {
        const deactivateAll = db.prepare('UPDATE voice_profiles SET is_active = 0');
        const activate = db.prepare('UPDATE voice_profiles SET is_active = 1, updated_at = datetime(\'now\') WHERE id = ?');
        const transaction = db.transaction((profileId) => {
            deactivateAll.run();
            activate.run(profileId);
        });
        transaction(id);
        return { success: true };
    },

    updateProfile: (id, data) => {
        const ALLOWED_COLUMNS = ['name', 'ref_audio_path', 'transcript', 'quality_score', 'quality_details', 'samples_count', 'total_duration', 'is_trained', 'model_path', 'is_active'];
        const fields = [];
        const values = {};
        for (const [key, value] of Object.entries(data)) {
            if (ALLOWED_COLUMNS.includes(key)) {
                fields.push(`${key} = @${key}`);
                values[key] = value;
            }
        }
        if (fields.length === 0) return { success: false, error: 'No fields to update' };
        fields.push("updated_at = datetime('now')");
        values.id = id;
        const sql = `UPDATE voice_profiles SET ${fields.join(', ')} WHERE id = @id`;
        db.prepare(sql).run(values);
        return { success: true };
    },

    deleteProfile: (id) => {
        db.prepare('DELETE FROM voice_profiles WHERE id = ?').run(id);
        return { success: true };
    },
};
