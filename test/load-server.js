import http from 'k6/http';
import { sleep } from 'k6';

export let options = {
    vus: 500,
    duration: '5m', // รัน 1 ชั่วโมง
};

export default function () {
    http.get('http://192.168.1.108:3000/watch?id=1');
    sleep(2.25); // หน่วงเวลาให้ประมาณ 1600 requests/ชั่วโมง
}