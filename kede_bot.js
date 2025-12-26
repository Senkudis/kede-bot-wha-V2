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

// ===== 1. تهيئة خادم UPTIME =====
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.status(200).send('Kede Bot is running and awake! 🤖');
});

app.listen(PORT, () => {
    console.log(`✅ Uptime Server listening on port ${PORT}`);
});

// ===== 2. اتصال قاعدة البيانات =====
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error("❌ MONGO_URI غير موجود!");
} else {
    mongoose.connect(MONGO_URI)
        .then(() => console.log("✅ تم الاتصال بـ MongoDB."))
        .catch(err => console.error("❌ فشل الاتصال:", err));
}

// تعريف نموذج البيانات
const BotDataSchema = new mongoose.Schema({
    _id: { type: Number, default: 2 },
    subscribers: { type: [String], default: [] },
    pendingQuiz: { type: Object, default: {} },
    pendingGames: { type: Object, default: {} },
    groupStats: { type: Array, default: [] },
    welcomedChatsPrivate: { type: [String], default: [] },
    welcomedChatsGroups: { type: [String], default: [] },
}, { timestamps: true, strict: false });

const BotData = mongoose.model('BotData', BotDataSchema);

async function getBotData() {
    let data = await BotData.findById(2);
    if (!data) {
        data = new BotData({ _id: 2, groupStats: [] });
        await data.save();
    }
    return data;
}

async function saveData(data) {
    if (MONGO_URI) {
        data.markModified('groupStats');
        data.markModified('pendingQuiz');
        data.markModified('pendingGames');
        await data.save();
    }
}

let botDataCache = null;

// ===== 3. البيانات والمحتوى =====
const IMGBB_KEY = process.env.IMGBB_KEY; 

const jokes = [
  "قال ليك في مسطول بكتب مع الأستاذ وكل ما الأستاذ يمسح السبوره يشرط الورقة",
  "مسطول شغال بتاع مرور قبض واحد يفحط قطعة إيصال بثلاثين ألف قام أداه خمسين الف المسطول قالي مامعاي فكه فحط بالعشرين الباقية وتعال.",
  "طبيب اسنان قال لي زبونو : حسيت بي وجع؟ قال ليهو: مهما كان في الم ما بصل الم الفاتورة الجاياني اسي .",
  "مرة واحد مشى السوق، نسى يرجع!",
  "واحد قال لي صاحبو: عندك ساعة؟ قال ليهو: لا والله الزمن فاتني."
];

const triviaQuestions = [
  { q: "ما هي عاصمة السودان؟\nأ) الخرطوم\nب) أم درمان\nج) الأبيض", answer: "أ" },
  { q: "ما هو النهر الأشهر في السودان؟\nأ) النيل\nب) الدمحله\nج) الفرات", answer: "أ" },
  { q: "ما هو العنصر الذي رمزه H؟\nأ) هيليوم\nب) هيدروجين\nج) هافنيوم", answer: "ب" },
  { q: "كم عدد قارات العالم؟\nأ) 5\nب) 6\nج) 7", answer: "ج" },
  { q: "ما هو أسرع حيوان بري؟\nأ) الأسد\nب) الفهد\nج) الغزال", answer: "ب" }
];

const facts = [
  "هل تعلم أن قلب الحوت الأزرق أكبر من سيارة؟",
  "النحل يمكنه التعرف على وجوه البشر!",
  "الأخطبوط لديه ثلاثة قلوب.",
  "الصين هي أكبر دولة من حيث عدد السكان.",
  "الموز يحتوي على مادة مشعة طبيعية بنسبة ضئيلة."
];

const quotes = [
  "الحياة قصيرة، اجعلها جميلة.",
  "ابتسم، فالحياة تستحق.",
  "العقل زينة.",
  "من جد وجد ومن زرع حصد."
];

const prayerReminders = [
  "قوموا يا عباد الله إلى الصلاة ",
  "حيّ على الصلاة، حيّ على الفلاح 🕌",
  "الله أكبر، وقت السجود قد حان 🕋",
  "الصلاة نور وراحة للروح، لا تفوّتوها"
];

const greetings = ["صباح الخير يا زول! 🌞", "صبحكم الله بالخير!", "صباح النور يا الغوالي!"];

const BOT_PERSONA = `
تعليمات النظام:
1. اسمك "كيدي" (Kede).
2. المطور هو "ضياء الدين ابراهيم".
3. تتحدث باللهجة السودانية (يا زول، حبابك، أبشر، قدام).
4. كن مرحاً ومفيداً.
`;

// ===== 4. الدوال المساعدة =====
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function getContactNameOrNumber(id) {
  try { const c = await client.getContactById(id); return c.pushname || c.name || c.number || id; }
  catch { return id; }
}

async function googleTranslate(text, targetLang = 'en') {
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
        const res = await axios.get(url);
        return res.data[0].map(x => x[0]).join('');
    } catch { return text; }
}

async function getPollinationsText(userText) {
    try {
        console.log("⏳ جاري الاتصال بالذكاء الاصطناعي...");
        const fullPrompt = `${BOT_PERSONA}\n\nالمستخدم: ${userText}\nكيدي:`;
        const response = await axios.post('https://text.pollinations.ai/', {
            messages: [{ role: 'user', content: fullPrompt }],
            model: 'openai' 
        }, { headers: { 'Content-Type': 'application/json' }, timeout: 20000 });
        
        let reply = response.data;
        if (typeof reply === 'object') reply = reply.choices ? reply.choices[0].message.content : JSON.stringify(reply);
        return reply;
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

function getCommandsList() {
  return `🤖 *أوامر كيدي (الكاملة)*

🧠 *الذكاء:*
- كيدي [سؤالك]: للدردشة معي
- تخيل [وصف]: لرسم صورة
- ترجم [نص] إلى [en/fr]: للترجمة

🎮 *الترفيه:*
- العب رقم: خمن الرقم
- لغز: سؤال وجواب
- حجر، ورق، مقص
- نكتة / معلومة / اقتباس

📊 *خدمات:*
- طقس [المدينة]
- التاريخ / احصائيات
- اشترك / الغاء (للتذكيرات)

👨‍💻 المطور: ضياءالدين ابراهيم`;
}

// ===== 5. إعداد العميل =====
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process', '--no-zygote']
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
      let groupIds = Array.isArray(data.groupStats) ? data.groupStats.map(g => g.id) : [];
      const allTargets = [...new Set([...data.subscribers, ...groupIds])];
      allTargets.forEach(id => client.sendMessage(id, text).catch(()=>{}));
    }, { timezone: 'Africa/Khartoum' });
    prayerJobs.push(job);
  }
}

cron.schedule('5 0 * * *', schedulePrayerReminders, { timezone: 'Africa/Khartoum' });
cron.schedule('0 8 * * *', async () => {
    const data = await getBotData();
    const text = pickRandom(greetings);
    data.subscribers.forEach(id => client.sendMessage(id, text).catch(()=>{}));
}, { timezone: 'Africa/Khartoum' });

client.on('qr', async qr => {
    try {
        console.log('📌 تم توليد QR...');
        const qrDataUrl = await QRCode.toDataURL(qr);
        console.log('Scan QR inside Render Logs');
        if (IMGBB_KEY) {
            const base64Image = qrDataUrl.split(';base64,').pop();
            const form = new FormData();
            form.append('image', base64Image);
            const resp = await axios.post(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, form, { headers: { ...form.getHeaders(), 'Content-Type': 'multipart/form-data' } });
            if (resp.data?.data?.url) console.log('✅ رابط الـ QR:', resp.data.data.url);
        }
    } catch (err) { console.error('❌ خطأ رفع QR:', err); }
});

client.on('ready', async () => {
    console.log('✅ كيدي جاهز 100%!');
    botDataCache = await getBotData();
    schedulePrayerReminders();
});

// ===== 6. معالج الرسائل =====
client.on('message', async (msg) => {
    const data = botDataCache || await getBotData();
    const from = msg.from;
    const body = msg.body.trim();
    if (from === 'status@broadcast') return;

    // 1. القروبات
    if (msg.from.endsWith('@g.us')) {
        const chat = await msg.getChat();
        let groupObj = data.groupStats.find(g => g.id === from);
        if (!groupObj) {
            groupObj = { id: from, messages: {}, createdTimestamp: chat.createdTimestamp || Date.now() };
            data.groupStats.push(groupObj);
        }
        const author = msg.author || from;
        const safeAuthor = author.replace(/\./g, '_');
        groupObj.messages[safeAuthor] = (groupObj.messages[safeAuthor] || 0) + 1;
        
        // تنبيه المصفوفة للتعديل
        data.markModified('groupStats');
        await saveData(data);

        if (!data.welcomedChatsGroups.includes(from)) {
            data.welcomedChatsGroups.push(from);
            await saveData(data);
            await chat.sendMessage(getCommandsList());
        }
    }

    // 2. الردود السريعة
    if (body === 'كيدي') return msg.reply(pickRandom(["حبابك", "جنبك", "موجود، كيف أقدر أخدمك؟", "يا زول أنا جاهز"]));
    if (body === 'اوامر' || body === 'مساعدة') return msg.reply(getCommandsList());
    if (body === 'نكتة') return msg.reply(pickRandom(jokes));
    if (body === 'معلومة') return msg.reply(pickRandom(facts));
    if (body === 'اقتباس') return msg.reply(pickRandom(quotes));

    // 3. الذكاء الاصطناعي (معالج بشكل صحيح)
    if (body.startsWith('كيدي ')) {
        const prompt = body.substring(5).trim();
        if (!prompt) return msg.reply("أها يا زول، قول داير شنو؟");
        const aiResponse = await getPollinationsText(prompt);
        return msg.reply(aiResponse);
    }
    // أمر بديل للذكاء
    if (body.startsWith('ذكاء ')) {
        const prompt = body.substring(5).trim();
        const aiResponse = await getPollinationsText(prompt);
        return msg.reply(aiResponse);
    }

    if (body.startsWith('تخيل')) {
        const prompt = body.substring(4).trim();
        msg.reply('🎨 جاري الرسم...');
        const base64 = await getPollinationsImage(prompt);
        if (base64) {
            const media = new MessageMedia('image/jpeg', base64);
            return client.sendMessage(from, media, { caption: 'صورة من كيدي!' });
        } else return msg.reply('تعذر الرسم حالياً.');
    }

    // 4. الخدمات (طقس / ترجمة / تاريخ)
    if (body.startsWith('طقس')) return msg.reply(await getWeather(body.substring(3).trim()));
    if (body === 'التاريخ') return msg.reply(`التاريخ: ${new Date().toLocaleDateString('ar-SD')}`);
    
    if (body.startsWith('ترجم ')) {
        // مثال: ترجم Hello world إلى ar
        const parts = body.match(/^ترجم (.+) إلى (\w{2})$/);
        if (!parts) return msg.reply('الصيغة: ترجم [النص] إلى [رمز اللغة] (مثال: ترجم Hello إلى ar)');
        return msg.reply(await googleTranslate(parts[1], parts[2]));
    }

    if (body === 'اشترك') {
        if (!data.subscribers.includes(from)) {
            data.subscribers.push(from);
            await saveData(data);
            return msg.reply('✅ تم الاشتراك.');
        } else return msg.reply('مشترك بالفعل.');
    }
    if (body === 'الغاء') {
        const idx = data.subscribers.indexOf(from);
        if (idx > -1) {
            data.subscribers.splice(idx, 1);
            await saveData(data);
            return msg.reply('❌ تم الالغاء.');
        }
    }

    // 5. الألعاب (تخمين / لغز / حجر ورق مقص)
    // --- لعبة التخمين ---
    if (body === 'العب رقم') {
        data.pendingGames[from] = { type: 'guess', target: Math.floor(Math.random() * 10) + 1, attempts: 0 };
        data.markModified('pendingGames');
        await saveData(data);
        return msg.reply('خمن رقم من 1 لـ 10!');
    }
    
    if (data.pendingGames[from]?.type === 'guess') {
        const guess = parseInt(body);
        if (!isNaN(guess)) {
            const game = data.pendingGames[from];
            game.attempts++;
            if (guess === game.target) {
                delete data.pendingGames[from];
                data.markModified('pendingGames');
                await saveData(data);
                return msg.reply(`🎉 صح! الرقم هو ${game.target}`);
            } else {
                return msg.reply(guess < game.target ? 'أكبر' : 'أصغر');
            }
        }
    }

    // --- لعبة اللغز ---
    if (body === 'لغز') {
        const q = pickRandom(triviaQuestions);
        data.pendingQuiz[from] = q;
        data.markModified('pendingQuiz');
        await saveData(data);
        return msg.reply(`${q.q}`);
    }

    if (['أ','ب','ج','A','B','C'].includes(body) || ['أ','ب','ج'].includes(body.trim())) {
        const q = data.pendingQuiz[from];
        if (q) {
            const answer = body.trim().replace('A','أ').replace('B','ب').replace('C','ج');
            const isCorrect = answer === q.answer;
            delete data.pendingQuiz[from];
            data.markModified('pendingQuiz');
            await saveData(data);
            return msg.reply(isCorrect ? '✅ إجابة صحيحة!' : `❌ خطأ، الإجابة هي ${q.answer}`);
        }
    }

    // --- لعبة حجر ورق مقص ---
    if (['حجر','ورق','مقص'].includes(body)) {
        const choices = ['حجر','ورق','مقص'];
        const botChoice = pickRandom(choices);
        let res = '';
        if (body === botChoice) res = 'تعادل 😐';
        else if ((body === 'حجر' && botChoice === 'مقص') || 
                 (body === 'ورق' && botChoice === 'حجر') || 
                 (body === 'مقص' && botChoice === 'ورق')) res = 'مبروك فزت 🎉';
        else res = 'خسرت 😢';
        return msg.reply(`أنا اخترت: ${botChoice}\nالنتيجة: ${res}`);
    }
    
    // 6. الاحصائيات
    if (body === 'احصائيات' && msg.from.endsWith('@g.us')) {
        let groupObj = data.groupStats.find(g => g.id === from);
        if (!groupObj) return msg.reply('لا توجد بيانات.');
        const sorted = Object.entries(groupObj.messages).sort(([, a], [, b]) => b - a);
        let txt = '*📊 التفاعل:*\n';
        for (let i = 0; i < Math.min(5, sorted.length); i++) {
            let [safeId, count] = sorted[i];
            let realId = safeId.replace(/_/g, '.'); 
            const name = await getContactNameOrNumber(realId);
            txt += `${i+1}. ${name}: ${count}\n`;
        }
        return msg.reply(txt);
    }

});

// 7. ترحيب بالعضو الجديد (إرجاع الميزة المفقودة)
client.on('group_join', async (notification) => {
    try {
        const chat = await notification.getChat();
        const contact = await client.getContactById(notification.id.participant);
        // نستخدم mentions عشان نعمل منشن للعضو
        await chat.sendMessage(`👋 أهلاً بك @${contact.id.user} في *${chat.name}*! نورتنا 🌹`, { mentions: [contact] });
    } catch (e) {
        console.error("Welcome Error:", e);
    }
});

// 8. حفظ عند الاغلاق
process.on('SIGINT', async () => {
    console.log("Shutting down...");
    await mongoose.disconnect();
    process.exit(0);
});

client.initialize();
