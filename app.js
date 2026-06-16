const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcrypt');
const db = require('./database'); // sqlite3 connection
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const morgan = require('morgan');
const multer = require('multer');
const tmp = require('tmp');
const sqlite3 = require('sqlite3').verbose();

// import redis
const { createClient } = require('redis');
const redisClient = createClient({
  url: 'redis://redis:6379'
});

redisClient.connect()
  .then(() => console.log('Redis connected'))
  .catch(err => console.error('Redis connection error:', err));

// end redis


// Cache สำหรับภาพ
const crypto = require('crypto');

const IMAGE_CACHE_DIR = path.join(__dirname, 'public', 'cache_images');

// สร้างโฟลเดอร์ถ้ายังไม่มี
if (!fs.existsSync(IMAGE_CACHE_DIR)) {
  fs.mkdirSync(IMAGE_CACHE_DIR, { recursive: true });
}

async function cacheImage(url) {
  const hash = crypto.createHash('md5').update(url).digest('hex');
  const ext = path.extname(url.split('?')[0]) || '.jpg';
  const filePath = path.join(IMAGE_CACHE_DIR, `${hash}${ext}`);
  const localUrl = `/cache_images/${hash}${ext}`;

  // 1️⃣ เช็คใน Redis ก่อน
  const redisKey = `image_cache:${hash}`;
  const cached = await redisClient.get(redisKey);

  if (cached && fs.existsSync(filePath)) {
    // Redis บอกว่ามีแล้ว + ไฟล์มีอยู่ → ใช้ไฟล์เดิม
    return localUrl;
  }

  // 2️⃣ ถ้าไม่มี → ดาวน์โหลดรูป
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
    fs.writeFileSync(filePath, response.data);

    // 3️⃣ อัปเดต Redis ว่ารูปถูก cache แล้ว
    // กำหนด TTL เช่น 7 วัน (7*24*60*60 วินาที)
    await redisClient.setEx(redisKey, 7 * 24 * 60 * 60, 'cached');

    return localUrl;
  } catch (err) {
    console.error('Error caching image:', err.message);
    return url; // fallback
  }
}

// ================= Punycode ==================

require('dotenv').config();

const USER = process.env.USER;
const PASSWORD = process.env.PASSWORD;

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
  secret: 'your_secret_key',
  resave: false,
  saveUninitialized: true
}));

// -------------------- Logging --------------------
// เขียน access log
const accessLogStream = fs.createWriteStream(path.join(__dirname, 'access.log'), { flags: 'a' });
app.use(morgan(':date[iso] :remote-addr :method :url :status :res[content-length] - :response-time ms', { stream: accessLogStream }));
app.use(morgan('dev')); // log แบบ console-friendly

// ฟังก์ชันเวลาไทย
function getThaiTime() {
  return new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
}

// ----- Users (hardcoded example, password hashed with bcrypt) -----
const users = [
  { username: USER, password: PASSWORD } // password hashed
];

// ----- Middleware ตรวจสอบ Admin -----
function isAdmin(req, res, next) {
  if (req.session.user && req.session.user.username === 'admin') {
    return next();
  }
  res.redirect('/admin/login');
}

// ----- Routes -----
// Login
app.get('/admin/login', (req, res) => res.render('login'));
app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username);
  if (!user) return res.send('Invalid username or password');

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.send('Invalid username or password');

  req.session.user = { username: user.username };
  res.redirect('/manage');
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).send('Logout error');
    res.redirect('/admin/login');
  });
});

// List media (public)
app.get('/', async (req, res) => {
  const pageParam = parseInt(req.query.page, 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const limit = 12;

  db.get("SELECT COUNT(*) AS count FROM media", [], (err, row) => {
    if (err) return res.status(500).send(err.message);

    const totalItems = row?.count || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    const currentPage = Math.min(Math.max(page, 1), totalPages);
    const offset = (currentPage - 1) * limit;

    // ดึงเฉพาะหน้าที่ต้องการ (เรียงล่าสุดก่อน)
    db.all(
      "SELECT * FROM media ORDER BY id DESC LIMIT ? OFFSET ?",
      [limit, offset],
      async (err2, mediaList) => {
        if (err2) return res.status(500).send(err2.message);

        // ⭐⭐ ทำ cache รูปภาพตรงนี้ ⭐⭐
        for (let item of mediaList) {
          if (item.image_embed) {
            item.image_embed = await cacheImage(item.image_embed);
          }
        }

        db.all("SELECT * FROM tags", [], (err3, tags) => {
          if (err3) return res.status(500).send(err3.message);

          res.render('index', {
            mediaList: mediaList || [],
            tags: tags || [],
            user: req.session.user || null,
            currentPage,
            totalPages
          });
        });
      }
    );
  });
});

// API Real Video Link Player
app.get('/api/v1/media_main/:id', (req, res) => {
  db.get("SELECT * FROM media WHERE id = ?", [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!row) return res.status(404).json({ error: 'Media not found' });
    res.json(row);
  });
});

// Manage page (Admin only)
app.get('/manage', isAdmin, (req, res) => {
  db.all("SELECT * FROM media", [], (err, rows) => {
    if (err) return res.send(err.message);
    res.render('manage', { mediaList: rows, user: req.session.user });
  });
});

// page ads
app.get('/ads', (req, res) =>{
  res.render('ads');
})

app.get('/new-videos', async (req, res) => {
  db.all("SELECT * FROM media ORDER BY id DESC LIMIT 20", [], async (err, rows) => {
    if (err) return res.status(500).send('Database error');

    const videos = [];

    for (const video of rows) {
      const v = { ...video };

      // ไม่แปลง URL อะไรทั้งนั้น
      // ดาวน์โหลดรูปภาพมาทำ Cache
      v.image_embed = await cacheImage(v.image_embed);

      videos.push(v);
    }

    res.render('new-videos', { videos });
  });
});

app.get('/load-page', (req, res) => {
  return res.render('load_page');
});

// Short Link

app.get('/short-link', (req, res) => {
  return res.render('short_link');
});

app.post('/shorten', (req, res) => {
    const { url } = req.body;
    const idHash = Math.random().toString(36).substring(2, 8);
    
    // ดึง Domain จาก Request Header โดยอัตโนมัติ
    const domain = req.get('host'); 
    const protocol = req.protocol; // เช่น http หรือ https
    const fullLink = `${protocol}://${domain}/links/${idHash}`;

    db.run("INSERT INTO links (id, url) VALUES (?, ?)", [idHash, url], (err) => {
        if (err) return res.status(500).send("บันทึกข้อมูลไม่ได้");
        
        // ส่งค่ากลับเป็น Dynamic Link
        res.send(`ลิงก์สำเร็จ: <a href="/links/${idHash}" target="_blank">${fullLink}</a>`);
    });
});

app.get('/links/:id', (req, res) => {
    const id = req.params.id;

    db.get("SELECT url FROM links WHERE id = ?", [id], (err, row) => {
        if (err || !row) return res.status(404).send("ไม่พบลิงก์นี้ในระบบ");

        // ส่งหน้า HTML ดักบอท (ไม่ให้ดึงรูป)
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta property="og:image" content="">
                <meta property="og:title" content=" ">
                <meta name="robots" content="noindex, nofollow">
                <script>window.location.href = "${row.url}";</script>
            </head>
            <body></body>
            </html>
        `);
    });
});

// Add media
app.get('/add', isAdmin, (req, res) => res.render('add'));
app.post('/add', isAdmin, (req, res) => {
  const { topic, image_embed, video_embed, tag } = req.body;
  const tags = Array.isArray(tag) ? tag.join(',') : tag;
  db.run(
    "INSERT INTO media (topic, image_embed, video_embed, tag) VALUES (?, ?, ?, ?)",
    [topic, image_embed, video_embed, tags],
    (err) => {
      if (err) {
        console.log(err); // log เพื่อ debug
        return res.send(err.message);
      }
      res.redirect('/manage');
    }
  );
});

// Edit media
app.get('/edit/:id', isAdmin, (req, res) => {
  db.get("SELECT * FROM media WHERE id = ?", [req.params.id], (err, row) => {
    if (err) return res.send(err.message);
    res.render('edit', { media: row });
  });
});

app.post('/edit/:id', isAdmin, (req, res) => {
  const { topic, image_embed, video_embed, views } = req.body;
  db.run(
    "UPDATE media SET topic=?, image_embed=?, video_embed=?, views=? WHERE id=?",
    [topic, image_embed, video_embed, views, req.params.id],
    (err) => {
      if (err) return res.send(err.message);
      res.redirect('/manage');
    }
  );
});

// Delete media
app.get('/delete/:id', isAdmin, (req, res) => {
  db.run("DELETE FROM media WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.send(err.message);
    res.redirect('/manage');
  });
});

// ตัวจัดการ /watch แบบไฮบริด: เข้าแบบเก่า (?id=) แต่จะเปลี่ยนเป็นแบบใหม่ (/watch/id/topic) อัตโนมัติ!
// ตัวจัดการ /watch แบบไฮบริด: เข้าแบบเก่า (?id=) แต่จะเปลี่ยนเป็นแบบใหม่ (/watch/id/topic) อัตโนมัติ!
app.get('/watch', (req, res) => {
  const id = req.query.id;
  if (!id || isNaN(id)) return res.status(404).send("Video not found");

  db.get("SELECT topic FROM media WHERE id = ?", [id], (err, row) => {
    if (err || !row) return res.status(404).send("Video not found");

    const safeTopic = encodeURIComponent(row.topic.replace(/ /g, '-').replace(/\//g, ''));
    
    // 🚨 ใส่ 301 ตรงนี้ครับ!
    res.redirect(301, `/watch/${id}/${safeTopic}`);
  });
});

// รองรับ URL แบบใหม่ที่คุณต้องการ: /watch/375/ชื่อวิดีโอ
app.get('/watch/:id/:topic?', (req, res) => {
  const id = req.params.id;

  // 🚨 แก้จุดที่ 3: ดักจับโครงสร้าง URL แบบใหม่ ถ้าตรงตำแหน่ง :id แฮกเกอร์ส่งค่ามั่วที่ไม่ใช่ตัวเลขมา ให้ส่ง 404 ทันที
  if (!id || isNaN(id)) {
    return res.status(404).send("Video not found");
  }

  // 1. ดึงข้อมูลวิดีโอหลักที่กำลังดู
  db.get("SELECT * FROM media WHERE id = ?", [id], (err, row) => {
    // 🚨 แก้จุดที่ 4: เปลี่ยนจากพ่นข้อความระบบพัง (500) ให้ส่ง 404 แทน เพื่อเซฟคะแนน Google Search Console
    if (err || !row) {
      return res.status(404).send("Video not found");
    }

    // 2. ดึงวิดีโอแนะนำสุ่ม 10 ตัว (ยกเว้นตัวที่กำลังดู)
    db.all("SELECT * FROM media WHERE id != ? ORDER BY RANDOM() LIMIT 10", [id], (err2, randoms) => {
      if (err2) {
        // ถ้าเกิดเออร์เรอร์แปลกๆ ในคำสั่ง SQL ย่อย ให้ดีดออก 404 เพื่อความปลอดภัย
        return res.status(404).send("Video not found");
      }

      // 3. ดึงคีย์เวิร์ดแท็กจากฐานข้อมูลเพื่อเอาไปทำ SEO เมนูด้านขวา (SSR)
      db.all("SELECT DISTINCT tag FROM media WHERE tag IS NOT NULL AND tag != '' LIMIT 15", [], (err3, tagRows) => {

        let allTags = [];
        if (!err3 && tagRows) {
          let tempTags = new Set();
          tagRows.forEach(r => {
            if (r.tag) {
              r.tag.split(',').forEach(t => tempTags.add(t.trim()));
            }
          });
          allTags = Array.from(tempTags).slice(0, 15);
        }

        // ส่งข้อมูลกลับไปเรนเดอร์ที่หน้าเว็บ watch.ejs เหมือนเดิมเป๊ะ
        res.render('watch', {
          media: row,
          randomVideos: randoms || [],
          allTags: allTags
        });
      });

    });
  });
});

// Proxy route ซ่อน URL วิดีโอ
app.get('/video-proxy/:id', async (req, res) => {
  const id = req.params.id;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  db.get("SELECT * FROM media WHERE id = ?", [id], async (err, row) => {
    if (err) return res.status(500).send(err.message);
    if (!row) return res.status(404).send('Video not found From Proxy');

    let videoUrl = (row.video_embed || '').trim().replace(/^"|"$/g, '');

    // log IP + URL + timestamp
    const logMessage = `[${getThaiTime()}] ${clientIp} requested video ID ${id}: ${videoUrl}`;
    console.log(logMessage);
    fs.appendFileSync('server.log', logMessage + '\n');

    if (videoUrl.startsWith('http')) {
      try {
        const response = await axios.get(videoUrl, { responseType: 'stream' });
        res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
        response.data.pipe(res);
      } catch (error) {
        console.error('Proxy fetch error:', error.message);
        res.status(500).send('Error fetching video');
      }
    } else {
      const filePath = path.join(__dirname, 'public', videoUrl);
      if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
      } else {
        res.status(404).send('Video file not found');
      }
    }
  });
});

app.get('/export-sqlite', isAdmin, (req, res) => {
  // ดึงข้อมูลจาก media
  db.all("SELECT * FROM media", [], (err, mediaRows) => {
    if (err) return res.status(500).send(err.message);

    // ดึงข้อมูลจาก ads
    db.all("SELECT * FROM ads", [], (err2, adsRows) => {
      if (err2) return res.status(500).send(err2.message);

      // ดึงข้อมูลจาก tags
      db.all("SELECT * FROM tags", [], (err3, tagRows) => {
        if (err3) return res.status(500).send(err3.message);

        // สร้างไฟล์ SQLite ชั่วคราว
        const tmpFile = tmp.tmpNameSync({ postfix: '.db' });
        const newDb = new sqlite3.Database(tmpFile);

        newDb.serialize(() => {
          // ===== สร้างตาราง media =====
          newDb.run(`CREATE TABLE media (
            id            INTEGER PRIMARY KEY,
            topic         TEXT,
            image_embed   TEXT,
            video_embed   TEXT,
            tag           TEXT,
            thumbnail_url TEXT,
            id_player     INTEGER,
            views         INTEGER
          )`);

          const mediaStmt = newDb.prepare(`INSERT INTO media
            (id, topic, image_embed, video_embed, tag, thumbnail_url, id_player, views)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
          mediaRows.forEach(row => {
            mediaStmt.run(
              row.id,
              row.topic,
              row.image_embed,
              row.video_embed,
              row.tag || null,
              row.thumbnail_url || null,
              row.id_player || null,
              row.views || 0
            );
          });
          mediaStmt.finalize();

          // ===== สร้างตาราง ads =====
          newDb.run(`CREATE TABLE ads (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            title     TEXT,
            video_url TEXT,
            click_url TEXT,
            duration  INTEGER,
            active    INTEGER DEFAULT 1
          )`);

          newDb.run(`
            CREATE TABLE videos_ads (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            files_name TEXT,
            active     INTEGER,
            comment    TEXT)`)

          const adsStmt = newDb.prepare(`INSERT INTO ads
            (id, title, video_url, click_url, duration, active)
            VALUES (?, ?, ?, ?, ?, ?)`);
          adsRows.forEach(row => {
            adsStmt.run(
              row.id,
              row.title,
              row.video_url,
              row.click_url,
              row.duration || 0,
              row.active || 1
            );
          });
          adsStmt.finalize();

          // ===== สร้างตาราง tags =====
          newDb.run(`CREATE TABLE tags (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE
          )`);

          const tagsStmt = newDb.prepare(`INSERT INTO tags (id, name) VALUES (?, ?)`);
          tagRows.forEach(row => {
            tagsStmt.run(row.id, row.name);
          });
          tagsStmt.finalize();

          // ปิด database และส่งไฟล์ให้ดาวน์โหลด
          newDb.close(() => {
            res.download(tmpFile, 'media_export.db', (err) => {
              fs.unlinkSync(tmpFile); // ลบไฟล์ชั่วคราวหลังดาวน์โหลด
              if (err) console.error('Download error:', err);
            });
          });

        }); // end serialize
      }); // end tags query
    }); // end ads query
  }); // end media query
});

// New Video API with proxy URLs
app.get('/api/v1/detail', (req, res) => {
  db.all("SELECT * FROM media ORDER BY id DESC", [], (err, rows) => {
    if (err) {
      console.error('DB error:', err.message);
      return res.status(500).json({ error: 'Database error' });
    }

    // สร้าง JSON พร้อม proxy URLs
    const data = rows.map(row => ({
      id: row.id,
      topic: row.topic,
      image_proxy: `/image-proxy/${row.id}`,   // new route สำหรับ image
      video_proxy: `/video-proxy/${row.id}`,
      tag: row.tag,
      thumbnail_url: row.thumbnail_url
    }));

    res.json(data);
  });
});

// Image proxy route
app.get('/image-proxy/:id', async (req, res) => {
  const id = req.params.id;

  db.get("SELECT * FROM media WHERE id = ?", [id], (err, row) => {
    if (err) return res.status(500).send(err.message);
    if (!row) return res.status(404).send('Image not found');

    const imageUrl = (row.image_embed || '').trim().replace(/^"|"$/g, '');

    if (imageUrl.startsWith('http')) {
      axios.get(imageUrl, { responseType: 'stream' })
        .then(response => {
          res.setHeader('Content-Type', response.headers['content-type']);
          response.data.pipe(res);
        })
        .catch(err => {
          console.error('Image fetch error:', err.message);
          res.status(500).send('Error fetching image');
        });
    } else {
      const filePath = path.join(__dirname, 'public', imageUrl);
      if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
      } else {
        res.status(404).send('Image file not found');
      }
    }
  });
});

// แสดง tag ทั้งหมด
// ================= TAGS CRUD =================

// READ: ดึง tag ทั้งหมด (API)
app.get('/api/v1/tags', (req, res) => {
  db.all("SELECT name AS tag FROM tags", [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    const tags = rows.map(row => row.tag);
    res.set('Cache-Control', 'no-store'); // ปิด cache
    res.json(tags);
  });
});

// READ (UI): แสดงหน้า tag ทั้งหมด
app.get('/tags', isAdmin, (req, res) => {
  db.all("SELECT * FROM tags", [], (err, rows) => {
    if (err) return res.status(500).send(err.message);
    res.render("tags", { tags: rows, user: req.session.user });
  });
});

// CREATE: เพิ่ม tag ใหม่
app.post('/tags', isAdmin, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).send("Tag name required");

  db.run("INSERT INTO tags (name) VALUES (?)", [name], function (err) {
    if (err) return res.status(500).send(err.message);
    res.redirect('/tags');
  });
});

// UPDATE: แก้ไข tag
app.post('/tags/edit/:id', isAdmin, (req, res) => {
  const { name } = req.body;
  const { id } = req.params;
  if (!name) return res.status(400).send("Tag name required");

  db.run("UPDATE tags SET name=? WHERE id=?", [name, id], function (err) {
    if (err) return res.status(500).send(err.message);
    res.redirect('/tags');
  });
});

// DELETE: ลบ tag
app.get('/tags/delete/:id', isAdmin, (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM tags WHERE id=?", [id], function (err) {
    if (err) return res.status(500).send(err.message);
    res.redirect('/tags');
  });
});

// Filter media ตาม tag
app.get('/tag/:tag', (req, res) => {
  const tag = decodeURIComponent(req.params.tag);
  const page = parseInt(req.query.page) || 1;
  const limit = 20;

  db.all("SELECT * FROM media WHERE tag LIKE ?", [`%${tag}%`], (err, allMedia) => {
    if (err) return res.send(err.message);

    // --- เพิ่มตรงนี้: เรียงลำดับจาก ID มากไปน้อย (ล่าสุดไปเก่า) ---
    allMedia.sort((a, b) => b.id - a.id);
    // --------------------------------------------------------

    // ทำ Pagination
    const totalPages = Math.ceil(allMedia.length / limit);
    const startIndex = (page - 1) * limit;
    const paginatedMedia = allMedia.slice(startIndex, startIndex + limit);

    db.all("SELECT * FROM tags", [], (err, allTags) => {
      if (err) return res.send(err.message);

      res.render('tag', { 
        mediaList: paginatedMedia, 
        allTags, 
        tag, 
        currentPage: page, 
        totalPages: totalPages, 
        user: req.session.user 
      });
    });
  });
});

app.get('/api/v1/video-list', (req, res) => {
  db.all("SELECT * FROM media", [], (err, rows) => {
    if (err) {
      console.error('DB error:', err.message);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// API ดึง video detail
app.get('/api/v1/video-search/:id', (req, res) => {
  const id = req.params.id;
  db.get("SELECT * FROM media WHERE id = ?", [id], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!row) return res.status(404).json({ error: 'Video not found' });
    res.json(row);
  });
});

// นับ View
app.post('/api/v1/media/:id/view', (req, res) => {
  const videoId = req.params.id;
  const sql = `UPDATE media SET views = IFNULL(views,0) + 1 WHERE id = ?`;

  db.run(sql, [videoId], function (err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ success: true, viewsUpdated: this.changes });
  });
});

app.get('/api/v1/top-views', (req, res) => {
  db.all("SELECT * FROM media ORDER BY views DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'No videos found' });
    res.json(rows);
  });
});

app.get('/api/v1/top-views/:limit', (req, res) => {
  const limit = parseInt(req.params.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) {
    return res.status(400).json({ error: 'Invalid limit parameter' });
  }

  db.all("SELECT * FROM media ORDER BY views DESC LIMIT ?", [limit], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'No videos found' });
    res.json(rows);
  });
});

// Most Popular
app.get('/most-popular', (req, res) => {
  db.all("SELECT * FROM media ORDER BY views DESC LIMIT 20", [], (err, rows) => {
    if (err) return res.status(500).send('Database error');

    // แปลง punycode ของ hostname ให้เป็น unicode
    const videos = rows.map(video => {
      try {
        const url = new URL(video.image_embed);
        url.hostname = punycode.toUnicode(url.hostname);
        video.image_embed = url.toString();
      } catch (e) {
        // ไม่ใช่ URL ถูกต้อง ให้ใช้ตรงๆ
      }
      return video;
    });

    res.render('most-popular', { videos });
  });
});

app.get('/search', (req, res) => {
  const keyword = req.query.q;
  const page = parseInt(req.query.page) || 1;
  const limit = 20;

  if (!keyword || keyword.trim() === '') {
    return res.redirect('/');
  }

  const sql = "SELECT * FROM media WHERE topic LIKE ? ORDER BY id DESC";
  const params = [`%${keyword}%`];

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).send('Database error');

    // ทำ Pagination
    const totalPages = Math.ceil(rows.length / limit);
    const startIndex = (page - 1) * limit;
    const paginatedVideos = rows.slice(startIndex, startIndex + limit).map(video => {
      const v = { ...video };
      try {
        const url = new URL(v.image_embed);
        // หมายเหตุ: ต้องมั่นใจว่ามีการ require('punycode') ไว้ด้านบนของไฟล์
        url.hostname = punycode.toUnicode(url.hostname);
        v.image_embed = url.toString();
      } catch { }
      return v;
    });

    res.render('search-results', { 
      videos: paginatedVideos, 
      keyword,
      currentPage: page,
      totalPages: totalPages
    });
  });
});

app.get('/api/v1/ads', (req, res) => {
  const sql = "SELECT * FROM ads";
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

app.get('/admin/ads', isAdmin, (req, res) => {
  db.all("SELECT * FROM ads ORDER BY id ASC", [], (err, ads) => {
    if (err) return res.status(500).send(err.message);
    res.render('admin-ads', { ads });
  });
});

// หน้า Admin Ads
app.get('/admin/ads', isAdmin, (req, res) => {
  db.all("SELECT * FROM ads ORDER BY id ASC", [], (err, ads) => {
    if (err) return res.status(500).send(err.message);
    res.render('admin-ads', { ads });
  });
});

// API CRUD
// GET all ads
app.get('/api/v1/ads', isAdmin, (req, res) => {
  db.all("SELECT * FROM ads ORDER BY id ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// POST new ad
app.post('/api/v1/ads', isAdmin, (req, res) => {
  const { title, video_url, click_url, duration, active } = req.body;
  if (!title || !video_url) return res.status(400).json({ error: 'Title and Video URL are required' });
  db.run(
    `INSERT INTO ads (title, video_url, click_url, duration, active) VALUES (?, ?, ?, ?, ?)`,
    [title, video_url, click_url, duration, active],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, title, video_url, click_url, duration, active });
    }
  );
});

// PUT update ad
app.put('/api/v1/ads/:id', isAdmin, (req, res) => {
  const { id } = req.params;
  const { title, video_url, click_url, duration, active } = req.body;
  if (!title || !video_url) return res.status(400).json({ error: 'Title and Video URL are required' });
  db.run(
    `UPDATE ads SET title=?, video_url=?, click_url=?, duration=?, active=? WHERE id=?`,
    [title, video_url, click_url, duration, active, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Updated successfully', id });
    }
  );
});

// DELETE ad
app.delete('/api/v1/ads/:id', isAdmin, (req, res) => {
  const { id } = req.params;
  db.run(`DELETE FROM ads WHERE id=?`, [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Deleted successfully', id });
  });
});

// -------------------- VideoAds CRUD --------------------
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, 'public', 'videos');
    if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const customName = req.body.filename || Date.now();
    const ext = path.extname(file.originalname);
    cb(null, customName + ext);
  }
});
const upload = multer({ storage });

// 📌 หน้าเดียว: list + form (Admin Only)
app.get('/admin/videos', isAdmin, (req, res) => {
  db.all('SELECT * FROM videos_ads ORDER BY id DESC', [], (err, rows) => {
    if (err) return res.status(500).send(err.message);
    res.render('videos_admin', { videos: rows, user: req.session.user });
  });
});

// 📌 Upload video
app.post('/admin/videos/upload', isAdmin, upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded.');

  const filename = req.file.filename;
  const comment = req.body.comment || '';
  const active = req.body.active ? parseInt(req.body.active) : 1;

  db.run(
    'INSERT INTO videos_ads (files_name, active, comment) VALUES (?, ?, ?)',
    [filename, active, comment],
    function (err) {
      if (err) return res.status(500).send(err.message);
      res.redirect('/admin/videos');
    }
  );
});

// 📌 Edit video
app.post('/admin/videos/edit/:id', isAdmin, (req, res) => {
  const { id } = req.params;
  const { filename, comment, active } = req.body;

  db.run(
    'UPDATE videos_ads SET files_name=?, comment=?, active=? WHERE id=?',
    [filename, comment, active, id],
    function (err) {
      if (err) return res.status(500).send(err.message);
      res.redirect('/admin/videos');
    }
  );
});

// 📌 Delete video
app.post('/admin/videos/delete/:id', isAdmin, (req, res) => {
  const { id } = req.params;

  db.get('SELECT files_name FROM videos_ads WHERE id=?', [id], (err, row) => {
    if (err) return res.status(500).send(err.message);
    if (!row) return res.status(404).send('Video not found');

    const filePath = path.join(__dirname, 'public', 'videos', row.files_name);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    db.run('DELETE FROM videos_ads WHERE id=?', [id], function (err) {
      if (err) return res.status(500).send(err.message);
      res.redirect('/admin/videos');
    });
  });
});

// API: ดึงเฉพาะวิดีโอที่ Active = 1
app.get('/api/v1/videos/active', (req, res) => {
  const sql = "SELECT * FROM videos_ads WHERE active = 1 ORDER BY id DESC";
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error("DB Error:", err.message);
      return res.status(500).json({ error: "Database error" });
    }

    res.json(rows); // ส่ง JSON ออกไป
  });
});

app.get('/api/v1/report', (req, res) => {
  const topic = req.query.topic;

  db.run(
    'UPDATE media SET id_player = ? WHERE topic = ?',
    [topic, topic],
    (err) => {
      if (err) return res.status(500).send(err.message);
      res.redirect('/');
    }
  );
});

// ===== Log IP + Method + URL ลงไฟล์แยก =====
app.use((req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;

    const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

    // แปลงเวลาเป็นไทย
    const timeThai = new Date().toLocaleString("th-TH", {
      timeZone: "Asia/Bangkok",
      hour12: false, // 24 ชั่วโมง
    });

    const logData = {
      time: timeThai,
      ip: clientIp,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      responseTime: duration + "ms",
      userAgent: req.get("User-Agent"),
    };

    const logLine = JSON.stringify(logData);
    console.log(logLine); // แสดงบน console
    fs.appendFileSync(path.join(__dirname, "essential-access.log"), logLine + "\n");
  });

  next();
});

app.use((req, res, next) => {
    res.status(404).send('404 Not Found');
});

// 2. ดักจับ Error ตัวสุดท้าย ถ้าโค้ดส่วนอื่นแครช ให้เปลี่ยนจาก 500 หน้าขาว เป็น 404 เพื่อเซฟอันดับ SEO
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(404).send('404 Not Found');
});

app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
