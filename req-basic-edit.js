const axios = require('axios');

const MEASUREMENT_ID = 'G-VLMJVZ7NQF';
const API_SECRET = 'DyduoaaJTNKftUQuufZ8VA';
const GA_URL = `https://www.google-analytics.com/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}`;

const genId = () => Math.random().toString(36).substring(2, 15);

// รายชื่อ User-Agent เพื่อความเนียน
const uas = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36'
];

/**
 * ส่งแบบ Batch (1 Request = 25 Events)
 * ปรับปรุงให้สุ่มความหลากหลายภายใน Batch เดียวกัน
 */
async function sendBatchTraffic() {
    // หมายเหตุ: GA4 Measurement Protocol กำหนดให้ 1 Batch มี 1 client_id
    // แต่เราสามารถทำให้ดูเนียนขึ้นได้โดยการใส่ params ที่ต่างกัน
    const payload = {
        client_id: genId(), 
        events: []
    };

    const sid = Math.floor(Date.now() / 1000).toString();

    for (let i = 0; i < 25; i++) {
        payload.events.push({
            name: 'page_view',
            params: {
                page_location: `https://jav789vk.com/?ref=batch_${i}`, // เพิ่ม query เล็กน้อยให้ URL ต่างกัน
                page_title: 'Home | JAV789VK',
                engagement_time_msec: 100,
                session_id: sid + i // สร้างความต่างให้ session ภายใน batch
            }
        });
    }

    try {
        await axios.post(GA_URL, payload, {
            headers: { 'User-Agent': uas[Math.floor(Math.random() * uas.length)] }
        });
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * คุมปริมาณการส่ง
 */
async function runPump(totalTarget, concurrency) {
    const batchesNeeded = Math.ceil(totalTarget / 25);
    let completed = 0;

    console.log(`🚀 Starting high-speed batch pump...`);
    console.log(`🎯 Target: ${totalTarget} events | Concurrency: ${concurrency} workers`);

    const worker = async () => {
        while (completed < batchesNeeded) {
            const success = await sendBatchTraffic();
            if (success) {
                completed++;
                // แสดงผลทุกๆ 2,500 users (100 batches)
                if (completed % 100 === 0) {
                    const currentTotal = completed * 25;
                    console.log(`✅ Progress: ${currentTotal.toLocaleString()} / ${totalTarget.toLocaleString()} sent.`);
                }
            }
            // ใส่ delay เล็กน้อยเพื่อไม่ให้โดน Google ตัดการเชื่อมต่อ (Rate Limit)
            await new Promise(r => setTimeout(r, 50));
        }
    };

    // สร้าง workers ตามจำนวนที่กำหนด
    const workers = [];
    for (let i = 0; i < concurrency; i++) {
        workers.push(worker());
    }

    await Promise.all(workers);
    console.log('🏁 Mission Accomplished: All traffic sent!');
}

// แนะนำ: สำหรับ 500,000 ครั้ง
// ถ้าเน็ตแรง ใช้ concurrency 10-20 ก็พอครับ เพราะ 1 batch ส่งทีละ 25 ยอดจะขึ้นไวมาก
runPump(20000, 15);