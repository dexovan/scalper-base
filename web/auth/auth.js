import bcrypt from "bcrypt";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";

// Use unified project paths (Windows + Linux safe)
import paths from "../../src/config/paths.js";

// DB location always inside data/
const dbPath = path.join(paths.DATA_DIR, "users.db");

export async function createDB() {
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Create default test user if none exists
    await createDefaultUser(db);

    return db;
}

async function createDefaultUser(db) {
    try {
        const existingUser = await db.get("SELECT COUNT(*) as count FROM users");

        if (existingUser.count === 0) {
            const hash = await bcrypt.hash("admin123", 10);
            await db.run(
                "INSERT INTO users (username, password) VALUES (?, ?)",
                ["admin", hash]
            );
            console.log("✅ Created default user: admin/admin123");
        }
    } catch (error) {
        console.warn("⚠️ Could not create default user:", error.message);
    }
}

export async function registerUser(db, username, password) {
    const hash = await bcrypt.hash(password, 10);
    await db.run(
        "INSERT INTO users (username, password) VALUES (?, ?)",
        [username, hash]
    );
}

export async function findUser(db, username) {
    return await db.get("SELECT * FROM users WHERE username = ?", [username]);
}

export async function authenticate(db, username, password) {
    const row = await db.get("SELECT * FROM users WHERE username = ?", [username]);
    if (!row) return false;
    return await bcrypt.compare(password, row.password);
}

export { dbPath };
