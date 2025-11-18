import bcrypt from "bcrypt";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import { fileURLToPath } from "url";

// Fix ES module paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Always resolve project root no matter where PM2 or Node is running
// /web/auth/auth.js → projectRoot = scalper-base/
const projectRoot = path.resolve(__dirname, "../../");

// Our database file → scalper-base/data/users.db
const dbPath = path.join(projectRoot, "data", "users.db");

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

    return db;
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

export { dbPath, projectRoot };
