const axios = require('axios');

const MEASUREMENT_ID = 'G-VLMJVZ7NQF';
const API_SECRET = 'DyduoaaJTNKftUQuufZ8VA';
const GA_URL = `https://www.google-analytics.com/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}`;
const TAGS_API_URL = 'https://jav789vk.com/api/v1/tags';

let cachedTags = [];
const genId = () => Math.random().toString(36).substring(2, 15);

const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
];

// ฟังก์ชันสุ่มแหล่งที่มา
function getRandomReferrer() {
    const refs = ['https://www.google.com/', 'https://www.facebook.com/', 'https://t.co/', ''];
    return refs[Math.floor(Math.random() * refs.length)];
}

// ฟังก์ชันคำนวณ Delay ตามช่วงเวลา (เวลาเครื่อง)
function getNextDelay() {
    const hour = new Date().getHours();
    if (hour >= 1 && hour <= 7) { 
        // ช่วงเช้ามืด (1,000 Sessions/วัน): ส่งทุกๆ 60-120 วินาที
        return Math.floor(Math.random() * 60000) + 60000;
    } else if (hour >= 19 && hour <= 23) {
        // ช่วงหัวค่ำ (5,000 Sessions/วัน): ส่งทุกๆ 10-25 วินาที
        return Math.floor(Math.random() * 15000) + 10000;
    }
    // ช่วงเวลาปกติ: ส่งทุกๆ 25-50 วินาที
    return Math.floor(Math.random() * 25000) + 25000;
}

async function fetchTags() {
    try {
        const response = await axios.get(TAGS_API_URL);
        cachedTags = response.data.map(t => t.slug || t.name || t);
        console.log(`✅ Tags Synced: ${cachedTags.length}`);
    } catch (e) {
        cachedTags = ['trending', 'new'];
    }
}

async function sendTraffic() {
    const cid = genId();
    const sid = Math.floor(Date.now() / 1000).toString();
    const ua = userAgents[Math.floor(Math.random() * userAgents.length)];
    const referrer = getRandomReferrer();
    const pagesToVisit = Math.floor(Math.random() * 3) + 1;

    for (let i = 0; i < pagesToVisit; i++) {
        const target = getRandomUrl();
        const payload = {
            client_id: cid,
            events: [{
                name: 'page_view',
                params: {
                    page_location: target.url,
                    page_title: target.title,
                    engagement_time_msec: Math.floor(Math.random() * 30000) + 10000, // สุ่มดู 10-40 วิ
                    session_id: sid,
                    page_referrer: referrer,
                    seg: '1'
                }
            }]
        };

        try {
            await axios.post(GA_URL, payload, { headers: { 'User-Agent': ua } });
            console.log(`[${new Date().toLocaleTimeString()}] User:${cid.substring(0,5)} -> ${target.url} (${referrer || 'Direct'})`);
            
            // รอจำลองการอ่านหน้าเว็บก่อนกดหน้าถัดไป
            if (i < pagesToVisit - 1) await new Promise(r => setTimeout(r, 15000));
        } catch (e) {
            console.error("❌ Link Down");
        }
    }
}

function getRandomUrl() {
    if (Math.random() < 0.4 && cachedTags.length > 0) {
        const tag = cachedTags[Math.floor(Math.random() * cachedTags.length)];
        return { url: `https://jav789vk.com/tag/${encodeURIComponent(tag)}`, title: `Tag: ${tag}` };
    }
    const page = Math.floor(Math.random() * 18) + 1;
    return { url: `https://jav789vk.com/?page=${page}`, title: `Page ${page}` };
}

async function main() {
    await fetchTags();
    (function loop() {
        sendTraffic();
        setTimeout(loop, getNextDelay());
    })();
    setInterval(fetchTags, 3600000);
}

main();