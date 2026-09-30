/* ตั้งค่าการเชื่อมต่อภายนอกของระบบ ปพ.5 Online
   ค่าทั้งหมดในไฟล์นี้เป็นข้อมูลสาธารณะของเว็บ ไม่ใช่ความลับ
   ความปลอดภัยจริงอยู่ที่ Firestore Security Rules และรายชื่อในคอลเลกชัน staff */
window.GRADEBOOK_CONFIG = {

  /* ใช้กับการสำรองข้อมูลขึ้น Google Sheet/Drive (ไม่บังคับ) */
  googleClientId: '',

  /* Firebase — ฐานข้อมูลกลางและการเข้าสู่ระบบด้วยบัญชี Google
     คัดลอกค่าจาก Firebase Console → ตั้งค่าโปรเจกต์ → แอปของคุณ → SDK setup */
  firebase: {
    // ⬇ 3 ค่านี้กรอกไว้ให้แล้วตามโปรเจกต์ pakchongallinone
    projectId: 'pakchongallinone',
    authDomain: 'pakchongallinone.firebaseapp.com',
    storageBucket: 'pakchongallinone.firebasestorage.app',
    // ⬇ 3 ค่านี้ต้องคัดลอกจาก Firebase Console → ⚙ ตั้งค่าโปรเจกต์ → ทั่วไป →
    //    เลื่อนลงหา "แอปของคุณ" → เลือกแอปเว็บ → SDK setup and configuration → Config
    apiKey: 'AIzaSyDB2mvWGylKoqAqh-kGoFyG1LoPD7lhEaY',
    messagingSenderId: '125092357274',
    appId: '1:125092357274:web:37b7a59abad103fc6aeb23'
  }
};
