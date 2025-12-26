require('dotenv').config();
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const fs = require("fs");
const cron = require("node-cron");
const path = require("path");
const QRCode = require("qrcode");
const axios = require("axios");
const FormData = require("form-data");

// ===== 1. تحميل وتهيئة البيانات =====
const DATA_FILE = path.join(__dirname, 'data.json');
let data = {};

if (fs.existsSync(DATA_FILE)) {
    try {
        data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    } catch (error) {
        console.error('❌ خطأ في قراءة ملف البيانات:', error);
        data = {};
    }
}

// تهيئة الحقول المفقودة (لضمان عدم حذف أي ميزة قديمة)
if (!Array.isArray(data.subscribers)) data.subscribers = [];
if (!data.pendingQuiz || typeof data.pendingQuiz !== 'object') data.pendingQuiz = {};
if (!data.pendingGames || typeof data.pendingGames !== 'object') data.pendingGames = {};
if (!data.stats || typeof data.stats !== 'object') data.stats = {};
if (!data.conversationHistory || typeof data.conversationHistory !== 'object') data.conversationHistory = {};
if (!data.groupStats || typeof data.groupStats !== 'object') data.groupStats = {};
if (!Array.isArray(data.welcomedChatsPrivate)) data.welcomedChatsPrivate = [];
if (!Array.isArray(data.welcomedChatsGroups)) data.welcomedChatsGroups = [];

saveData();

// ===== 2. الإعدادات والمتغيرات =====
const IMGBB_KEY = process.env.IMGBB_KEY; 

// ===== 2. البيانات الثابتة (النكت، الأسئلة، التذكيرات) =====
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

// ===== 2.5. أنماط التخيل =====
const IMAGE_STYLES = {
    'انمي': ', anime style, vibrant colors, studio ghibli',
    'واقعي': ', photorealistic, 8k, detailed, cinematic lighting',
    'فن_بكسل': ', pixel art, 8-bit, retro game style',
    'زيتي': ', oil painting, thick brushstrokes, masterpiece',
    'مائي': ', watercolor painting, soft edges, delicate',
    'سايبربانك': ', cyberpunk, neon lights, futuristic city, dark atmosphere',
    'فضاء': ', space art, nebula, stars, epic scale',
    'رسم': ', pencil sketch, detailed drawing, black and white'
};

// شخصية البوت
const BOT_PERSONA = `
تعليمات النظام:
1. اسمك "كيدي" (Kede).
2. المطور هو "ضياء الدين ابراهيم".
3. تتحدث باللهجة السودانية (يا زول، حبابك، أبشر).
4. كن مرحاً ومفيداً.
`;

// ===== 3. الدوال المساعدة والخدمات =====
function saveData() { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function getContactNameOrNumber(id) {
  try { const c = await client.getContactById(id); return c.pushname || c.name || c.number || id; }
  catch { return id; }
}

// خدمات API
async function googleTranslate(text, targetLang = 'ar') {
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
        const res = await axios.get(url);
        return res.data[0].map(x => x[0]).join('');
    } catch { return text; }
}

async function getPollinationsText(userText, history = []) {
    try {
        console.log("⏳ 1. دخلنا دالة الذكاء الاصطناعي...");

        let historyPrompt = history.map(m => `${m.role === 'user' ? 'المستخدم' : 'كيدي'}: ${m.content}`).join('\n');
        const fullPrompt = `${BOT_PERSONA}\n\n${historyPrompt}\nالمستخدم: ${userText}\nكيدي:`;

        console.log("🚀 2. جاري الإرسال لسيرفر Pollinations...");

        const response = await axios.post('https://text.pollinations.ai/', {
            messages: [
                { role: 'user', content: fullPrompt }
            ],
            model: 'openai' 
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 15000 
        });

        console.log("✅ 3. الرد وصل!");
        
        let reply = response.data;
        if (typeof reply === 'object') {
             reply = reply.choices ? reply.choices[0].message.content : JSON.stringify(reply);
        }

        return reply;

    } catch (error) {
        console.log("❌ حصل خطأ:");
        if (error.code === 'ECONNABORTED') {
            console.log("⏰ الوقت انتهى! السيرفر اتأخر في الرد.");
            return "معليش، النت شكلو تقيل، السيرفر اتأخر في الرد.";
        }
        console.error(error.message);
        return "في مشكلة في الاتصال بالذكاء الاصطناعي حالياً.";
    }
}

async function getPollinationsImage(arabicPrompt, styleSuffix = '') {
    try {
        const englishPrompt = await googleTranslate(arabicPrompt, 'en') + styleSuffix;
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(englishPrompt)}?model=nano-banana`;
        
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        return Buffer.from(response.data).toString('base64');
    } catch (error) { 
        console.error("Image Error:", error.message);
        return null; 
    }
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

// ===== 4. إعداد العميل والجدولة =====
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process', '--no-zygote'],
    }
});

let prayerJobs = [];

async function schedulePrayerReminders() {
  prayerJobs.forEach(j => j.stop());
  prayerJobs = [];
  
  const times = await getPrayerTimes();
  if (!times) return;
  
  const map = { Fajr: 'الفجر', Dhuhr: 'الظهر', Asr: 'العصر', Maghrib: 'المغرب', Isha: 'العشاء' };
  
  for (const key in map) {
    const [h, m] = times[key].split(':').map(Number);
    const job = cron.schedule(`${m} ${h} * * *`, () => {
      const text = `${pickRandom(prayerReminders)}\n🕒 حان موعد صلاة *${map[key]}*`;
      // إرسال للمشتركين + القروبات النشطة
      const allTargets = [...new Set([...data.subscribers, ...Object.keys(data.groupStats)])];
      allTargets.forEach(id => client.sendMessage(id, text).catch(()=>{}));
    }, { timezone: 'Africa/Khartoum' });
    prayerJobs.push(job);
  }
  console.log('🕌 تمت جدولة الصلاة.');
}

// الجدولة اليومية
cron.schedule('5 0 * * *', schedulePrayerReminders, { timezone: 'Africa/Khartoum' });

// رسالة صباحية
cron.schedule('0 8 * * *', () => {
    const text = pickRandom(greetings);
    data.subscribers.forEach(id => client.sendMessage(id, text).catch(()=>{}));
}, { timezone: 'Africa/Khartoum' });

// رسالة مسائية
cron.schedule('0 20 * * *', () => {
    data.subscribers.forEach(id => client.sendMessage(id, "مساء الخير! اكتب 'نكتة' عشان نضحك.").catch(()=>{}));
}, { timezone: 'Africa/Khartoum' });

// معالجة QR Code
client.on('qr', async qr => {
    try {
        console.log('📌 تم توليد QR — جارٍ رفعه...');
        // يمكنك استخدام QRCode.toString(qr, {type:'terminal'}) هنا لو الرفع فشل
        const qrPath = path.join(__dirname, 'qr.png');
        await QRCode.toFile(qrPath, qr);
        console.log('Scan the QR code found in root folder: qr.png');
        
        if (IMGBB_KEY) {
            const form = new FormData();
            form.append('image', fs.createReadStream(qrPath));
            const resp = await axios.post(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, form, { headers: form.getHeaders() });
            if (resp.data?.data?.url) console.log('✅ رابط الـ QR:', resp.data.data.url);
        }
    } catch (err) { console.error('❌ خطأ رفع QR:', err); }
});

client.on('ready', () => {
    console.log('✅ كيدي جاهز!');
    schedulePrayerReminders();
});

// قائمة الأوامر
function getCommandsList() {
  return `🤖 *أوامر كيدي v2.5*

🕌 *الدين والتذكيرات:*
- اشترك: تفعيل تذكيرات الصلاة
- الغاء: إيقاف التذكيرات

🎮 *الألعاب:*
- العب رقم: خمن الرقم من 1-10
- لغز: سؤال وجواب
- حجر، ورق، مقص

🧠 *الذكاء:*
- كيدي [سؤال]: ونسة مع كيدي (GPT-4o وبذاكرة سياقية)
- تخيل [وصف] [نمط]: رسم صور (Nano Banana وبأنماط جاهزة)
- حلل [نص/صورة]: تلخيص أو تحليل محتوى (باستخدام GPT-4o)
- ترجم [نص]: ترجمة 

📊 *أخرى:*
- احصائيات: تقرير تفاعل القروب
- نكتة / معلومة / اقتباس
- طقس [المدينة]
- التاريخ

👨‍💻 المطور: ضياءالدين كيدي
`;
}

// ===== 5. معالج الرسائل الرئيسي =====
client.on('message', async (msg) => {
    const from = msg.from;
    const body = msg.body.trim();
    if (from === 'status@broadcast') return;

    // 1. تجميع إحصائيات القروب
    if (msg.from.endsWith('@g.us')) {
        const chat = await msg.getChat();
        const g = data.groupStats[from] ||= { messages: {}, createdTimestamp: chat.createdTimestamp || Date.now() };
        // استبدال النقطة بـ _ عشان مونجو ما يزعل (لو بتستخدم مونجو مستقبلاً)
        const author = (msg.author || from).replace(/\./g, '_');
        g.messages[author] = (g.messages[author] || 0) + 1;
        saveData();
        
        // ترحيب القروب لأول مرة
        if (!data.welcomedChatsGroups.includes(from)) {
            data.welcomedChatsGroups.push(from);
            saveData();
            await chat.sendMessage(getCommandsList());
        }
    } else {
        // ترحيب الخاص لأول مرة
        if (!data.welcomedChatsPrivate.includes(from)) {
            data.welcomedChatsPrivate.push(from);
            saveData();
            await msg.reply(getCommandsList());
        }
    }

    // 2. أوامر الصلاة والاشتراك
    if (body === 'اشترك') {
        if (!data.subscribers.includes(from)) {
            data.subscribers.push(from);
            saveData();
            return msg.reply('✅ أبشر! تم تفعيل تذكير الصلاة والرسائل الصباحية.');
        } else return msg.reply('أنت مشترك بالفعل!');
    }
    if (body === 'الغاء') {
        const idx = data.subscribers.indexOf(from);
        if (idx > -1) {
            data.subscribers.splice(idx, 1);
            saveData();
            return msg.reply('❌ تم إلغاء الاشتراك.');
        } else return msg.reply('أنت غير مشترك.');
    }

    // 3. الأوامر العامة
    if (body === 'اوامر') return msg.reply(getCommandsList());
    if (body === 'كيدي') return msg.reply(pickRandom(["حبابك يا زول!", "آمرني!", "موجود، كيف أقدر أخدمك؟"]));
    
    // 5.1. نداء الذكاء الجديد: كيدي [سؤال]
    if (body.startsWith('كيدي ')) {
        const userQuery = body.slice(5).trim();
        if (!userQuery) return msg.reply('يا زول، أسألني سؤال عشان أجاوبك!');

        const chatHistory = data.conversationHistory[from] || [];
        const res = await getPollinationsText(userQuery, chatHistory);
        
        chatHistory.push({ role: 'user', content: userQuery });
        chatHistory.push({ role: 'bot', content: res });
        
        while (chatHistory.length > 10) {
            chatHistory.shift();
        }
        
        data.conversationHistory[from] = chatHistory;
        saveData();

        return msg.reply(res);
    }
    
    // 4. الترفيه والنكت
    if (body === 'نكتة') return msg.reply(pickRandom(jokes));
    
   if (body === 'معلومة') {
        const facts = [
            "السودان يمتلك أهرامات أكثر من مصر (أكثر من 200 هرم) في منطقة مروي والبجراوية.",
            "تعتبر منطقة 'المقرن' في الخرطوم النقطة التي يلتقي فيها النيل الأبيض بالنيل الأزرق ليشكلوا نهر النيل العظيم.",
            "أول امرأة برلمانية في أفريقيا والشرق الأوسط كانت سودانية، وهي الأستاذة فاطمة أحمد إبراهيم.",
            "محمية الدندر في السودان تعتبر واحدة من أكبر المحميات الطبيعية في أفريقيا.",
            "العسل هو الطعام الوحيد الذي لا يفسد أبداً؛ يمكن لأي شخص أكل عسل عمره 3000 سنة!",
            "حيوان الأخطبوط لديه ثلاثة قلوب وتعة عقول، ودمه لونه أزرق.",
            "قلب الحوت الأزرق ضخم جداً لدرجة أن الإنسان يمكنه السباحة داخل شرايينه.",
            "كوكب الزهرة هو الكوكب الوحيد الذي يدور في اتجاه عقارب الساعة (عكس باقي الكواكب).",
            "عدد النجوم في الكون أكثر من عدد حبات الرمل الموجودة على كل شواطئ الأرض.",
            "أقصر حرب في التاريخ كانت بين بريطانيا وزنجبار عام 1896، واستمرت 38 دقيقة فقط.",
            "مؤسس شركة أبل (ستيف جوبز) كان والده البيولوجي سورياً من مدينة حمص.",
            "عين النعامة أكبر من دماغها.",
            "لا يمكنك دندنة لحن وأنت تمسك أنفك مغلقاً (جربها الآن! 😉).",
            "التفاح يوقظك في الصباح أكثر من القهوة لاحتوائه على سكريات طبيعية."
        ];
        return msg.reply(pickRandom(facts));
    }

   if (body === 'اقتباس') {
        const quotes = [
            "السقوط ليس فشلاً، الفشل هو أن تبقى حيث سقطت.",
            "لا تؤجل عمل اليوم إلى الغد، فالفرص لا تنتظر.",
            "النجاح هو أن تنتقل من فشل إلى فشل دون أن تفقد حماسك.",
            "كن أنت التغيير الذي تريد أن تراه في العالم.",
            "عامل الناس بأخلاقك لا بأخلاقهم.",
            "من جد وجد، ومن زرع حصد.",
            "الوقت كالسيف، إن لم تقطعه قطعك.",
            "خير الكلام ما قل ودل.",
            "إذا هبت رياحك فاغتنمها.",
            "العلم في الصغر كالنقش على الحجر.",
            "يا زول، الدنيا دي ما بتستاهل، اضحك وعيش.",
            "الفي إيدو القلم ما بكتب على روحو شقي.",
            "مد رجليك قدر لحافك.",
            "كل تأخيرة وفيها خيرة إن شاء الله.",
            "النية زاملة سيدا (يعني النية الطيبة بتنجي صاحبها)."
        ];
        return msg.reply(pickRandom(quotes));
    }

    // 5. الألعاب
    if (body === 'العب رقم') {
        data.pendingGames[from] = { type: 'guess', number: Math.floor(Math.random()*10)+1, tries: 0 };
        saveData();
        return msg.reply('🔢 اخترت رقم من 1 لـ 10، حاول تخمنه!');
    }

    if (data.pendingGames[from]?.type === 'guess' && /^\d+$/.test(body)) {
        const g = data.pendingGames[from];
        const guess = parseInt(body);
        g.tries++;
        if (guess === g.number) {
            delete data.pendingGames[from];
            saveData();
            return msg.reply(`🎉 صح عليك! الرقم كان ${guess} (من ${g.tries} محاولات)`);
        }
        saveData();
        return msg.reply(guess < g.number ? '⬆️ أكبر!' : '⬇️ أصغر!');
    }

    if (body === 'لغز') {
        const q = pickRandom(triviaQuestions);
        data.pendingQuiz[from] = q;
        saveData();
        return msg.reply(q.q);
    }

    if (['أ','ب','ج','A','B','C'].some(x => x === body.toUpperCase())) {
        const p = data.pendingQuiz[from];
        if (p) {
            const ans = body.toLowerCase().replace('a','أ').replace('b','ب').replace('c','ج');
            const correct = ans === p.answer;
            delete data.pendingQuiz[from];
            saveData();
            return msg.reply(correct ? '✅ إجابة صحيحة!' : '❌ خطأ، حظ أوفر.');
        }
    }

    if (['حجر','ورق','مقص'].includes(body)) {
        const botC = pickRandom(['حجر','ورق','مقص']);
        let res = body === botC ? 'تعادل' : 
                  (body==='حجر'&&botC==='مقص')||(body==='ورق'&&botC==='حجر')||(body==='مقص'&&botC==='ورق') ? 'فزت 🎉' : 'خسرت 😢';
        return msg.reply(`أنا اخترت: ${botC}\nالنتيجة: ${res}`);
    }

    // 6. الذكاء والخدمات
    if (body.startsWith('تخيل ')) {
        const promptText = body.slice(5).trim();
        if (!promptText) return msg.reply('يا زول، أديني وصف عشان أقدر أتخيل!');

        let styleSuffix = '';
        let finalPrompt = promptText;
        
        const parts = promptText.split(/\s+/);
        const lastWord = parts[parts.length - 1].toLowerCase();
        
        if (IMAGE_STYLES[lastWord]) {
            styleSuffix = IMAGE_STYLES[lastWord];
            finalPrompt = parts.slice(0, -1).join(' ');
        }

        await msg.reply('🎨 جاري الرسم...');
        const b64 = await getPollinationsImage(finalPrompt, styleSuffix);
        
        if (b64) {
            const media = new MessageMedia('image/jpeg', b64);
            client.sendMessage(from, media, { caption: `🖼️ ${promptText}` });
        } else msg.reply('فشل الرسم، حاول تاني.');
    }

    if (body.startsWith('ترجم ')) return msg.reply(await googleTranslate(body.slice(5)));
    
    if (body.startsWith('حلل ')) {
        const textToAnalyze = body.slice(4).trim();
        if (!textToAnalyze && !msg.hasMedia) return msg.reply('يا زول، أديني نص أو صورة عشان أحللها!');

        let analysisPrompt = '';
        let content = '';
        
        if (msg.hasMedia) {
            analysisPrompt = 'أرجو وصف الصورة المرفقة أو تلخيص محتواها.';
            content = 'صورة مرفقة';
            return msg.reply('معليش يا زول، حالياً ما بقدر أحلل الصور مباشرة. ممكن توصف لي الصورة أو تلخص النص المرفق؟');
        } else {
            content = textToAnalyze;
            analysisPrompt = `حلل أو لخص النص التالي بأسلوب مرح ومختصر:\n\n"${textToAnalyze}"`;
        }

        await msg.reply('🧠 جاري التحليل...');
        const res = await getPollinationsText(analysisPrompt);
        return msg.reply(res);
    }
    
    if (body.startsWith('طقس ')) return msg.reply(await getWeather(body.slice(4).trim()));
    
    if (body === 'التاريخ') {
        const d = new Date();
        return msg.reply(`📅 التاريخ: ${d.toLocaleDateString('en-GB')}`);
    }

    // 7. إحصائيات القروب (مع التاق ✅)
    if (body === 'احصائيات') {
        if (!msg.from.endsWith('@g.us')) return msg.reply('الميزة دي للقروبات بس.');

        let stats = {};
        if (Array.isArray(data.groupStats)) {
             const groupObj = data.groupStats.find(g => g.id === from);
             stats = groupObj ? groupObj.messages : {};
        } else {
             stats = data.groupStats[from]?.messages || {};
        }

        const sorted = Object.entries(stats).sort((a, b) => b[1] - a[1]).slice(0, 5);
        if (!sorted.length) return msg.reply('لسه مافي بيانات كفاية.');

        let report = '📊 *توب 5 أعضاء متفاعلين:*\n';
        let mentions = [];
        let rank = 1;

        for (const [id, count] of sorted) {
            // استرجاع النقطة للآيدي عشان الواتساب يتعرف عليه
            const realId = id.replace(/_/g, '.'); 
            
            try {
                const contact = await client.getContactById(realId);
                mentions.push(contact); 
                const number = realId.split('@')[0];
                report += `${rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🎖️'} @${number} : ${count} رسالة\n`;
            } catch (e) {
                report += `${rank} - ${realId} : ${count}\n`;
            }
            rank++;
        }

        return msg.reply(report, undefined, { mentions: mentions });
    }

}); // <--- 🔥 تم إضافة القوس الناقص هنا عشان الكود يشتغل صح 🔥

// ترحيب بالأعضاء الجدد في القروبات
client.on('group_join', async (notification) => {
    try {
        const chat = await notification.getChat();
        const contact = await client.getContactById(notification.id.participant);
        chat.sendMessage(`👋 أهلاً @${contact.id.user} نورت القروب!`, { mentions: [contact] });
    } catch {}
});

process.on('SIGINT', () => { saveData(); client.destroy(); process.exit(); });

client.initialize();
