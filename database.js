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

});

module.exports = db;
