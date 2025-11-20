const bcrypt = require('bcrypt');

async function generateHash() {
  const password = '1234'; // รหัสผ่านที่คุณอยากใช้
  const hash = await bcrypt.hash(password, 10);
  console.log(hash);
}

generateHash();
