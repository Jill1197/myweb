const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../database');

// --- Middleware ตรวจสอบสิทธิ์ ---
function isAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    res.redirect('/user/login');
}

// --- Route สมัครสมาชิก ---
router.post('/register', async (req, res) => {
    const { email, username, password } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        db.run("INSERT INTO users (email, username, password) VALUES (?, ?, ?)", 
        [email, username, hash], (err) => {
            if (err) {
                return res.send("สมัครไม่สำเร็จ: Email หรือ Username นี้ถูกใช้ไปแล้ว");
            }
            res.redirect('/user/login');
        });
    } catch (err) {
        res.status(500).send("เกิดข้อผิดพลาดจากระบบ");
    }
});

// --- Route ล็อกอิน (ช่องเดียวจบ) ---
router.post('/login', (req, res) => {
    const { login_id, password } = req.body;
    
    // ค้นหา user จาก email หรือ username พร้อมกัน
    const sql = "SELECT * FROM users WHERE email = ? OR username = ?";
    db.get(sql, [login_id, login_id], async (err, user) => {
        if (err || !user) {
            return res.send("ไม่พบผู้ใช้งานนี้ หรือชื่อผู้ใช้ไม่ถูกต้อง");
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.send("รหัสผ่านไม่ถูกต้อง");
        }

        // เก็บ session
        req.session.user = { id: user.id, name: user.username };
        res.redirect('/user/timeline');
    });
});

// router.post('/login', (req, res) => {
//     const { login_id, password } = req.body;
//     db.get("SELECT * FROM users WHERE email = ? OR username = ?", [login_id, login_id], async (err, user) => {
//         if (!user) return res.send("ไม่พบผู้ใช้งาน");

//         // [TEST] ลองข้ามขั้นตอน bcrypt ดูว่าเข้าได้ไหม
//         // ถ้าบรรทัดนี้ผ่าน แสดงว่าปัญหาอยู่ที่การ compare รหัสผ่าน
//         req.session.user = { id: user.id, name: user.username };
//         return res.redirect('/user/timeline');
//     });
// });

// Package
// router.get('/package', (req, res) => {
//     res.render('user/user-package');
// });

router.get('/package-content', (req, res) => {
    // ดึงค่าจากฐานข้อมูล (ตัวอย่าง)
    const userId = req.session.user.id;
    db.get("SELECT has_used_free_plan FROM user_subscriptions WHERE user_id = ?", [userId], (err, row) => {
        const hasUsed = row ? row.has_used_free_plan : 0;
        // render หน้า user-package ในโฟลเดอร์ user
        res.render('user/user-package', { hasUsedFreePlan: hasUsed });
    });
});

// ตัวอย่าง Middleware ในไฟล์แยก หรือไว้ใน app.js
function checkSubscription(req, res, next) {
    if (!req.session.user) return res.redirect('/user/login');
    
    // ดึงสถานะจาก DB
    db.get("SELECT end_date FROM user_subscriptions WHERE user_id = ?", [req.session.user.id], (err, row) => {
        const now = new Date();
        if (!row || new Date(row.end_date) < now) {
            return res.redirect('/user/package'); // บังคับไปหน้าเลือกแพ็กเกจ
        }
        next();
    });
}

// --- Route Timeline ---
router.get('/timeline', (req, res) => {
    // แสดงหน้าหลักโดยไม่มี content พิเศษ
    res.render('user/user-timeline', { userName: req.session.user.name });
});

router.get('/profile', (req, res) => {
    // แสดงหน้า Profile โดยดึงไฟล์ user-profile.ejs มาไว้ในเมนเนื้อหา
    res.render('user/user-timeline', { 
        userName: req.session.user.name, 
        content: 'user-profile' // ชี้ไปที่ไฟล์ views/user/user-profile.ejs
    });
});

// --- หน้าเลือกแพ็กเกจ (รับจากฟอร์ม) ---
const plans = {
    2: { name: 'Monthly', price: 1.99, plisio_link: 'https://plisio.net/payment-button/new/-TNFSTFgm6wi' },
    3: { name: 'Yearly', price: 19.99, plisio_link: 'https://plisio.net/payment-button/new/CIvKfB3cC0zP' },
    4: { name: 'Lifetime', price: 29.99, plisio_link: 'https://plisio.net/payment-button/new/vpphNP4BuJI6' }
};

// ในไฟล์ routes/user.js ปรับตรงนี้ครับ
router.post('/subscribe', isAuthenticated, (req, res) => {
    const { plan_id } = req.body;
    
    const plansData = {
        1: { name: 'Free Plan', price: 0 },
        2: { name: 'Monthly', price: 1.99, plisio_link: 'https://plisio.net/payment-button/new/-TNFSTFgm6wi' },
        3: { name: 'Yearly', price: 19.99, plisio_link: 'https://plisio.net/payment-button/new/CIvKfB3cC0zP' },
        4: { name: 'Lifetime', price: 29.99, plisio_link: 'https://plisio.net/payment-button/new/vpphNP4BuJI6' }
    };

    const selectedPlan = plansData[plan_id];
    
    if (!selectedPlan) {
        return res.send("ไม่พบแพ็กเกจที่เลือก");
    }

    // กรณีแผนฟรี
    if (plan_id == 1) {
        return res.redirect('/user/timeline');
    }

    // ส่งตัวแปร plan และ userName ไปให้หน้า EJS
    res.render('user/user-payment', { 
        plan: selectedPlan,
        userName: req.session.user.name 
    });
});

// --- หน้าชำระเงิน (แสดง 3 ช่องทาง) ---
router.get('/payment-page', isAuthenticated, (req, res) => {
    // กรณีนี้ควรส่ง plan_id มาด้วย หรือเก็บใน session ก่อนหน้า
    res.render('user/user-payment');
});

// --- Route ออกจากระบบ ---
router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/user/login');
});

module.exports = router;