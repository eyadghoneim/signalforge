import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// تسجيل الـ Service Worker (PWA): بيمنح فتح أسرع + تثبيت كتطبيق.
// مشروط بلوكال هوست؟ لأ — الـ worker بيتسجل دايماً بعيدًا عن أخطاء الـ preview لو فشل.
if ('serviceWorker' in navigator && !location.hostname.includes('localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* الـ PWA اختياري — الفشل لا يؤثر على الوظيفة الأساسية */
    });
  });
}
