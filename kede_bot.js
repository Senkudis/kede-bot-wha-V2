require('dotenv').config();
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const fs = require("fs");
const cron = require("node-cron");
const path = require("path");
const QRCode = require("qrcode");
const axios = require("axios");
const FormData = require("form-data");
const mongoose = require("mongoose");
const express = require("express");

// ===== 1. تهيئة خادم UPTIME (للاستضافة المجانية) =====
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.status(200).send('Kede Bot is running and awake! 🤖');
});

app.listen(PORT, () => {
    console.log(`✅ Uptime Server listening on port ${PORT}`);
});

// ===== 2. اتصال قاعدة البيانات (MongoDB) =====
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error("❌ MONGO_URI غير موجود في ملف .env. لن يتم حفظ البيانات!");
} else {
    mongoose.connect(MONGO_URI)
        .then(() => console.log("✅ تم الاتصال بقاعدة بيانات MongoDB."))
        .catch(err => console.error("❌ فشل الاتصال بـ MongoDB:", err));
}

// تعريف نموذج البيانات (BotData)
// التعديل: تغيير نوع البيانات لمصفوفة وتغيير الـ ID لـ 2 لتجاوز الأخطاء القديمة
const BotDataSchema = new mongoose.Schema({
    _id: { type: Number, default: 2 }, // 👈 غيرناه لـ 2 عشان يبدأ صفحة جديدة ونظيفة
    subscribers: { type: [String], default: [] },
    pendingQuiz: { type: Object, default: {} },
    pendingGames: { type: Object, default: {} },
    groupStats: { type: Array, default: [] }, // 👈 مصفوفة بدل Map لحل مشكلة النقطة
    welcomedChatsPrivate: { type: [String], default: [] },
    welcomedChatsGroups: { type: [String], default: [] },
}, { timestamps: true, strict: false });

const BotData = mongoose.model('BotData', BotDataSchema);

// دالة لجلب البيانات أو إنشائها إذا لم تكن موجودة
async function getBotData() {
    // 👈 غيرنا البحث عن ID 2
    let data = await BotData.findById(2);
    if (!data) {
        data = new BotData({ _id: 2, groupStats: [] });
        await data.save();
    }
    return data;
}

// دالة لحفظ البيانات (تحديث بسيط)
async function saveData(data) {
    if (MONGO_URI) {
        // تنبيه الداتابيس أن المصفوفة تغيرت (مهم جداً مع المصفوفات)
        data.markModified('groupStats');
        await data.save();
    } else {
        console.warn("⚠️ لم يتم حفظ البيانات لأن MONGO_URI غير متوفر.");
    }
}

// متغير عالمي لحفظ البيانات المجلوبة
let botDataCache = null;

// ===== 3. الإعدادات والمتغيرات الثابتة =====
const IMGBB_KEY = process.env.IMGBB_KEY; 
const jokes = [
  "قال ليك في مسطول بكتب مع الأستاذ وكل ما الأستاذ يمسح السبوره يشرط الورقة",
  "مسطول شغال بتاع مرور قبض واحد يفحط قطعة إيصال بثلاثين ألف قام أداه خمسين الف المسطول قالي مامعاي فكه فحط بالعشرين الباقية وتعال.",
  "طبيب اسنان قال لي زبونو : حسيت بي وجع؟ قال ليهو: مهما كان في الم ما بصل الم الفاتورة الجاياني اسي .",
  "مرة واحد مشى السوق، نسى يرجع!",
  "واحد قال لي صاحبو: عندك ساعة؟ قال ليهو: لا والله الزمن فاتني.",
  "مسطول شاف لافتة مكتوب عليها (ممنوع الوقوف) انبطح."
];

const triviaQuestions = [
  { q: "ما هي عاصمة السودان؟\nأ) الخرطوم\nب) أم درمان\nج) الأبيض", answer: "أ" },
  { q: "ما هو النهر الأشهر في السودان؟\nأ) النيل\nب) الدمحله\nج) الفرات", answer: "أ" },
  { q: "ما هو العنصر الذي رمزه H؟\nأ) هيليوم\nب) هيدروجين\nج) هافنيوم", answer: "ب" }
];

const prayerReminders = [
  "قوموا يا عباد الله إلى الصلاة ",
  "حيّ على الصلاة، حيّ على الفلاح 🕌",
  "الله أكبر، وقت السجود قد حان 🕋",
  "الصلاة نور وراحة للروح، لا تفوّتوها",
  "هلمّوا إلى ذكر الله ولقاء الرحمن",
  "أقم الصلاة لذكر الله، وارح قلبك"
];

const greetings = ["صباح الخير يا زول! 🌞", "صبحك الله بالخير!", "صباح النور يا الغالي!"];

// شخصية البوت
const BOT_PERSONA = `
تعليمات النظام:
1. اسمك "كيدي" (Kede).
2. المطور هو "ضياء الدين ابراهيم".
3. تتحدث باللهجة السودانية (يا زول، حبابك، أبشر).
4. كن مرحاً ومفيداً.
`;

// ===== 4. الدوال المساعدة والخدمات =====
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function getContactNameOrNumber(id) {
  try { const c = await client.getContactById(id); return c.pushname || c.name || c.number || id; }
  catch { return id; }
}

// خدمات API
async function googleTranslate(text, targetLang = 'en') {
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
        const res = await axios.get(url);
        return res.data[0].map(x => x[0]).join('');
    } catch { return text; }
}

async function getPollinationsText(userText) {
    try {
        const fullPrompt = `${BOT_PERSONA}\n\nالمستخدم: ${userText}\nكيدي:`;
        const url = `https://text.pollinations.ai/${encodeURIComponent(fullPrompt)}?model=openai`;
        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        console.error("AI Error:", error.message);
        return "معليش يا زول، الشبكة الليلة كعبة شوية، جرب تاني!";
    }
}

async function getPollinationsImage(arabicPrompt) {
    try {
        const englishPrompt = await googleTranslate(arabicPrompt, 'en');
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(englishPrompt)}?model=flux`;
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        return Buffer.from(response.data).toString('base64');
    } catch { return null; }
}

async function getWeather(city) {
  try {
    const cityEn = await googleTranslate(city, 'en');
    const apiKey = '316d0c91eed64b65a15211006251008'; 
    const resp = await axios.get(`http://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${encodeURIComponent(cityEn)}&lang=ar`);
    const d = resp.data;
    return `الطقس في ${d.location.name}: ${d.current.condition.text}\n🌡️ الحرارة: ${d.current.temp_c}°C\n💧 الرطوبة: ${d.current.humidity}%`;
  } catch { return 'ما قدرت أعرف الطقس، تأكد من اسم المدينة.'; }
}

async function getPrayerTimes() {
  try {
    const res = await axios.get('https://api.aladhan.com/v1/timingsByCity', { params: { city: 'Khartoum', country: 'Sudan', method: 2 } });
    return res.data?.data?.timings || null;
  } catch { return null; }
}

// قائمة الأوامر
function getCommandsList() {
  return `🤖 *أوامر كيدي v2.5 (النسخة الكاملة)*

🕌 *الدين والتذكيرات:*
- اشترك: تفعيل تذكيرات الصلاة
- الغاء: إيقاف التذكيرات

🎮 *الألعاب:*
- العب رقم: خمن الرقم من 1-10
- لغز: سؤال وجواب
- حجر، ورق، مقص

🧠 *الذكاء:*
- ذكاء [سؤال]: ونسة مع كيدي
- تخيل [وصف]: رسم صور (يدعم العربي)
- ترجم [نص]: ترجمة 

📊 *أخرى:*
- احصائيات: تقرير تفاعل القروب
- نكتة / معلومة / اقتباس
- طقس [المدينة]
- التاريخ

👨‍💻 المطور: ضياءالدين كيدي
`;
}

// ===== 5. إعداد العميل والجدولة =====
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', 
            '--disable-gpu'
        ]
    }
});
let prayerJobs = [];

async function schedulePrayerReminders() {
  const data = await getBotData();
  
  prayerJobs.forEach(j => j.stop());
  prayerJobs = [];
  
  const times = await getPrayerTimes();
  if (!times) return;
  
  const map = { Fajr: 'الفجر', Dhuhr: 'الظهر', Asr: 'العصر', Maghrib: 'المغرب', Isha: 'العشاء' };
  
  for (const key in map) {
    const [h, m] = times[key].split(':').map(Number);
    const job = cron.schedule(`${m} ${h} * * *`, () => {
      const text = `${pickRandom(prayerReminders)}\n🕒 حان موعد صلاة *${map[key]}*`;
      
      // التعديل: جلب المشتركين والقروبات من المصفوفة
      let groupIds = [];
      if (Array.isArray(data.groupStats)) {
          groupIds = data.groupStats.map(g => g.id);
      }
      
      const allTargets = [...new Set([...data.subscribers, ...groupIds])];
      allTargets.forEach(id => client.sendMessage(id, text).catch(()=>{}));
    }, { timezone: 'Africa/Khartoum' });
    prayerJobs.push(job);
  }
  console.log('🕌 تمت جدولة الصلاة.');
}

// الجدولة اليومية
cron.schedule('5 0 * * *', schedulePrayerReminders, { timezone: 'Africa/Khartoum' });

// رسالة صباحية
cron.schedule('0 8 * * *', async () => {
    const data = await getBotData();
    const text = pickRandom(greetings);
    data.subscribers.forEach(id => client.sendMessage(id, text).catch(()=>{}));
}, { timezone: 'Africa/Khartoum' });

// رسالة مسائية
cron.schedule('0 20 * * *', async () => {
    const data = await getBotData();
    data.subscribers.forEach(id => client.sendMessage(id, "مساء الخير! اكتب 'نكتة' عشان نضحك.").catch(()=>{}));
}, { timezone: 'Africa/Khartoum' });

// معالجة QR Code
client.on('qr', async qr => {
    try {
        console.log('📌 تم توليد QR — جارٍ رفعه...');
        const qrDataUrl = await QRCode.toDataURL(qr);
        console.log('Scan the QR code found in the console (Data URL).');
        
        if (IMGBB_KEY) {
            const base64Image = qrDataUrl.split(';base64,').pop();
            const form = new FormData();
            form.append('image', base64Image);
            
            const resp = await axios.post(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, form, { 
                headers: {
                    ...form.getHeaders(),
                    'Content-Type': 'multipart/form-data'
                }
            });
            if (resp.data?.data?.url) console.log('✅ رابط الـ QR:', resp.data.data.url);
        }
    } catch (err) { console.error('❌ خطأ رفع QR:', err); }
});

client.on('ready', async () => {
    console.log('✅ كيدي جاهز!');
    botDataCache = await getBotData();
    schedulePrayerReminders();
});

client.on('message', async (msg) => {
    const data = botDataCache || await getBotData(); 
    const from = msg.from;
    const body = msg.body.trim();
    if (from === 'status@broadcast') return;

    // 1. تجميع إحصائيات القروب (الكود المعدل لحل المشكلة)
    if (msg.from.endsWith('@g.us')) {
        const chat = await msg.getChat();
        
        // البحث عن القروب داخل المصفوفة (Array)
        let groupObj = data.groupStats.find(g => g.id === from);
        
        if (!groupObj) {
            groupObj = { 
                id: from, 
                messages: {}, 
                createdTimestamp: chat.createdTimestamp || Date.now() 
            };
            data.groupStats.push(groupObj);
        }
        
        const author = msg.author || from;
        // 👇 الحركة السحرية: استبدال النقطة بشرطة سفلية عشان ما تعمل مشاكل مع Mongoose
        const safeAuthor = author.replace(/\./g, '_'); 
        
        groupObj.messages[safeAuthor] = (groupObj.messages[safeAuthor] || 0) + 1;
        
        // حفظ البيانات
        await saveData(data);
        
        // كود الترحيب
        if (!data.welcomedChatsGroups.includes(from)) {
            data.welcomedChatsGroups.push(from);
            await saveData(data);
            await chat.sendMessage(getCommandsList());
        }
    }

    // 2. أوامر الصلاة والاشتراك
    if (body === 'اشترك') {
        if (!data.subscribers.includes(from)) {
            data.subscribers.push(from);
            await saveData(data);
            return msg.reply('✅ أبشر! تم تفعيل تذكير الصلاة والرسائل الصباحية.');
        } else return msg.reply('أنت مشترك بالفعل!');
    }
    if (body === 'الغاء') {
        const idx = data.subscribers.indexOf(from);
        if (idx > -1) {
            data.subscribers.splice(idx, 1);
            await saveData(data);
            return msg.reply('❌ تم إلغاء الاشتراك.');
        } else return msg.reply('أنت غير مشترك.');
    }

    // 3. الأوامر العامة
    if (body === 'اوامر') return msg.reply(getCommandsList());
    if (body === 'كيدي') return msg.reply(pickRandom(["حبابك يا زول!", "آمرني!", "موجود، كيف أقدر أخدمك؟"]));
    
    // 4. الترفيه والنكت
    if (body === 'نكتة') return msg.reply(pickRandom(jokes));
    
    // 5. الذكاء الاصطناعي والخدمات
    if (body.startsWith('ذكاء')) {
        const prompt = body.substring(4).trim();
        if (!prompt) return msg.reply('أمرني يا زول، أسألني أي حاجة!');
        const response = await getPollinationsText(prompt);
        return msg.reply(response);
    }
    
    if (body.startsWith('تخيل')) {
        const prompt = body.substring(4).trim();
        if (!prompt) return msg.reply('أديني وصف عشان أرسم ليك صورة!');
        msg.reply('أبشر، جاري توليد الصورة... دي بتاخد شوية وقت.');
        const base64Image = await getPollinationsImage(prompt);
        if (base64Image) {
            const media = new MessageMedia('image/jpeg', base64Image, 'image.jpg');
            return client.sendMessage(from, media, { caption: 'صورة من كيدي!' });
        } else {
            return msg.reply('معليش، ما قدرت أرسم الصورة دي حالياً.');
        }
    }
    
    if (body.startsWith('طقس')) {
        const city = body.substring(4).trim();
        if (!city) return msg.reply('أكتب اسم المدينة بعد كلمة "طقس"');
        const weatherText = await getWeather(city);
        return msg.reply(weatherText);
    }
    
    // 6. الألعاب
    if (body === 'العب رقم') {
        const gameId = from;
        const target = Math.floor(Math.random() * 10) + 1;
        data.pendingGames[gameId] = { type: 'guess', target: target, attempts: 0 };
        await saveData(data);
        return msg.reply('يلا يا زول، خمن رقم من 1 لـ 10!');
    }
    
    if (data.pendingGames[from] && data.pendingGames[from].type === 'guess') {
        const guess = parseInt(body);
        const game = data.pendingGames[from];
        
        if (isNaN(guess) || guess < 1 || guess > 10) {
            return msg.reply('ياخوي، خمن رقم صحيح بين 1 و 10.');
        }
        
        game.attempts++;
        
        if (guess === game.target) {
            delete data.pendingGames[from];
            await saveData(data);
            return msg.reply(`🎉 مبروك! خمنت صح في ${game.attempts} محاولة. الرقم كان ${game.target}.`);
        } else if (guess < game.target) {
            return msg.reply('الرقم أكبر من كده.');
        } else {
            return msg.reply('الرقم أصغر من كده.');
        }
    }
    
    // 7. إحصائيات القروب (الكود المعدل لقراءة المصفوفة)
    if (body === 'احصائيات' && msg.from.endsWith('@g.us')) {
        // البحث في المصفوفة
        const groupObj = data.groupStats.find(g => g.id === from);
        if (!groupObj || !groupObj.messages) return msg.reply('مافي بيانات لسه، ابدأوا الونسة!');
        
        const sorted = Object.entries(groupObj.messages).sort(([, a], [, b]) => b - a);
        
        let statsText = '*📊 إحصائيات تفاعل القروب:*\n\n';
        
        for (let i = 0; i < Math.min(5, sorted.length); i++) {
            let [safeId, count] = sorted[i];
            // ترجيع النقطة عشان نجيب الاسم صح
            let realId = safeId.replace(/_/g, '.'); 
            const name = await getContactNameOrNumber(realId);
            statsText += `${i + 1}. ${name}: ${count} رسالة\n`;
        }
        
        return msg.reply(statsText);
    }
    
    // 8. أوامر أخرى
    if (body === 'التاريخ') {
        const date = new Date().toLocaleDateString('ar-SD', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        return msg.reply(`اليوم هو: ${date}`);
    }

}); // إغلاق دالة message

// تشغيل البوت (مرة واحدة فقط هنا)
client.initialize();
