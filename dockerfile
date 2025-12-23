FROM ghcr.io/puppeteer/puppeteer:21.5.2

USER root

WORKDIR /usr/src/app

# نسخ ملفات المشروع
COPY package*.json ./

# تخطي تحميل كروم لأننا بنستخدم النسخة الجاهزة في الصورة
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# تثبيت المكاتب
RUN npm install

# نسخ باقي الكود
COPY . .

# تشغيل البوت
CMD [ "node", "kede_bot.js" ]
