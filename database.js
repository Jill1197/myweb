const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data.db');

db.serialize(() => {
  // ตารางสำหรับวิดีโอหลัก
  db.run(`CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT,
  image_embed TEXT,
  video_embed TEXT,
  tag TEXT,
  thumbnail_url TEXT,
  id_player INTEGER,
  views INTEGER DEFAULT 0
)`);


  // ตารางสำหรับ Ads
  db.run(`CREATE TABLE IF NOT EXISTS ads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    video_url TEXT,      -- ไฟล์/ลิงก์ของโฆษณา (mp4, youtube)
    click_url TEXT,      -- ลิงก์ที่จะเปิดเมื่อกดโฆษณา
    duration INTEGER,    -- ความยาวโฆษณา (วินาที)
    active INTEGER DEFAULT 1 -- 1 = แสดง, 0 = ปิด
  )`);

  // ตาราง tags (optional) ถ้าอยากเก็บรายการ tag ทั้งหมด)
  db.run(`CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS links (
    id TEXT PRIMARY KEY,
    url TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,      -- เพิ่มอีเมล
    password TEXT NOT NULL,          -- รหัสผ่านที่ hash แล้ว
    plan_type TEXT DEFAULT 'free', 
    subscription_end DATETIME
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS watch_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    media_id INTEGER,
    watched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(media_id) REFERENCES media(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_subscriptions (
    user_id INTEGER PRIMARY KEY,
    plan_type TEXT DEFAULT 'free',
    start_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    end_date DATETIME,
    has_used_free_plan INTEGER DEFAULT 0, -- 0 = ยังไม่เคยใช้, 1 = ใช้ไปแล้ว
    FOREIGN KEY(user_id) REFERENCES users(id)
)`);

});

module.exports = db;
