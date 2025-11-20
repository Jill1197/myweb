FROM node:20

# ทำงานใน /usr/src/app
WORKDIR /usr/src/app

# Copy package.json ก่อนเพื่อติดตั้ง dependencies
COPY package*.json ./

# ติดตั้ง dependencies
RUN npm install

# Copy code ที่เหลือ
COPY . .

# สร้างไฟล์ log ถ้ายังไม่มี
RUN touch access.log essential-access.log \
    && mkdir -p public/videos public/image \
    && mkdir -p views/components

# เปิด port
EXPOSE 3000

# ใช้ root
USER root

# รัน app
CMD ["node", "app.js"]