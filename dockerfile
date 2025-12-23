FROM ghcr.io/puppeteer/puppeteer:21.5.2

USER root

# مسار العمل
WORKDIR /usr/src/app

# نسخ ملف الباكيج (بعد ما تعدل اسمه)
COPY package*.json ./

# تخطي تحميل كروم لأننا بنستخدم النسخة الجاهزة
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# تثبيت المكاتب
RUN npm install

# نسخ باقي الملفات
COPY . .

# أمر التشغيل (معدل لاسم ملفك)
CMD [ "node", "kede_bot.js" ]
