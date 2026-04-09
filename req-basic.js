const axios = require('axios');

const MEASUREMENT_ID = 'G-VLMJVZ7NQF';
const API_SECRET = 'DyduoaaJTNKftUQuufZ8VA';
const GA_URL = `https://www.google-analytics.com/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}`;

// ฟังก์ชันสร้าง ID สุ่ม
const genId = () => Math.random().toString(36).substring(2, 15);

/**
 * ส่งแบบ Batch (1 Request = 25 Users/Events)
 */
async function sendBatchTraffic() {
    // สร้าง 25 client_id ที่ต่างกัน เพื่อให้ GA นับเป็น 25 Users ใหม่
    // หมายเหตุ: Measurement Protocol แบบ Batch ปกติจะใช้ 1 client_id ต่อ 1 request
    // แต่เราสามารถสุ่ม session_id และเพิ่มความหลากหลายได้
    
    const payload = {
        client_id: genId(), 
        events: []
    };

    // ใส่ได้สูงสุด 25 events ต่อ 1 request
    for (let i = 0; i < 25; i++) {
        payload.events.push({
            name: 'page_view',
            params: {
                page_location: 'https://jav789vk.com/',
                page_title: 'Home Page',
                engagement_time_msec: '5000', // ใส่เวลาหน่วงให้ดูเหมือนคนอ่านหน้าเว็บจริงๆ
                session_id: genId() // สุ่ม session id ทุกครั้ง
            }
        });
    }

    try {
        await axios.post(GA_URL, payload);
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * ฟังก์ชันหลักในการคุมปริมาณ
 * @param {number} totalTarget - จำนวนยอดที่ต้องการ (เช่น 500,000)
 * @param {number} concurrency - จำนวนการส่งพร้อมกัน (แนะนำ 10-50 ตามความแรงเน็ต)
 */
async function runPump(totalTarget, concurrency) {
    const batchesNeeded = Math.ceil(totalTarget / 25);
    let completed = 0;

    console.log(`🚀 Starting pump for ${totalTarget} users (${batchesNeeded} batches)...`);

    const worker = async () => {
        while (completed < batchesNeeded) {
            const success = await sendBatchTraffic();
            if (success) {
                completed++;
                if (completed % 100 === 0) {
                    console.log(`✅ Progress: ${completed * 25} / ${totalTarget} users sent.`);
                }
            }
        }
    };

    // รัน worker พร้อมกันตามค่า concurrency
    const workers = Array(concurrency).fill(null).map(worker);
    await Promise.all(workers);
    
    console.log('🏁 All traffic sent!');
}

// เริ่มรัน: เป้าหมาย 500,000 คน, ส่งพร้อมกัน 20 สาย
runPump(500000, 20);