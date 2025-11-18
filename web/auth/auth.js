import bcrypt from "bcrypt";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import { fileURLToPath } from "url";

// Fix za ES module path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Baza je u: /data/users.db (u korenu projekta)
const dbPath = path.join(__dirname, "../../data/users.db");

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
