const offlinePrompts = [
  "{topic} bo'yicha eng muhim tushuncha qaysi?",
  "{topic} haqidagi da'voni tekshirishda qaysi dalil ishonchliroq?",
  "{topic}ni kundalik hayotda qo'llashga qaysi misol mos keladi?",
  "{topic} bo'yicha xato javobni tuzatish uchun nima qilish kerak?",
  "{topic} mavzusida ikki fikr farq qilsa, qaysi qadam foydali?",
  "{topic}ni tushunganingni ko'rsatish uchun nimani izohlash kerak?",
  "{topic}ni eslab qolish uchun qaysi o'rganish usuli samarali?",
  "{topic}ga doir yangi ma'lumotni baholashda nimaga qaraladi?",
  "{topic} bo'yicha kichik loyiha nimadan boshlanishi mumkin?",
  "{topic}ni boshqalarga tushuntirishda qaysi yondashuv aniqroq?"
];

const sampleOptions = [
  ["Dalilni tekshirib, sababini tushuntirish", "Faqat sarlavhaga qarab xulosa qilish", "Manbani tekshirmasdan ulashish", "Birinchi taxminni to'g'ri deb olish"],
  ["Ishonchli manbalarni solishtirish", "Eng ko'p tarqalgan xabarni tanlash", "Qarshi dalillarni e'tiborsiz qoldirish", "Tasodifiy javob belgilash"],
  ["Aniq misol keltirib, natijani tekshirish", "Faqat atamani yoddan aytish", "Savolni boshqa mavzuga burish", "Hech qanday misol bermaslik"]
];

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function fallbackQuestions(topic, count) {
  const prompts = shuffle(offlinePrompts).slice(0, count);
  return prompts.map((template, index) => {
    const options = shuffle(sampleOptions[index % sampleOptions.length].map((text, optionIndex) => ({ text, optionIndex })));
    return {
      prompt: template.replaceAll("{topic}", topic),
      type: "multiple",
      options: options.map(option => option.text),
      correctOptionIndex: options.findIndex(option => option.optionIndex === 0)
    };
  });
}

function validateQuiz(value, count, topic) {
  if (!value || !Array.isArray(value.questions) || value.questions.length !== count) {
    throw new Error("AI kutilgan sondagi savollarni qaytarmadi.");
  }
  const title = String(value.title || `${topic} bo'yicha test`).trim().slice(0, 120);
  const description = String(value.description || `${topic} mavzusidagi bilimlarni sinab ko'ring.`).trim().slice(0, 600);
  const questions = value.questions.map((item, index) => {
    const prompt = String(item.prompt || "").trim().slice(0, 600);
    const type = item.type;
    if (!prompt || !["multiple", "text"].includes(type)) {
      throw new Error(`AI qaytargan ${index + 1}-savol yaroqsiz.`);
    }
    if (type === "text") return { prompt, type, options: [], correctOptionIndex: null };
    const options = Array.isArray(item.options) ? item.options.map(option => String(option).trim().slice(0, 300)) : [];
    const correctOptionIndex = Number(item.correctOptionIndex);
    if (options.length < 2 || options.length > 6 || !Number.isInteger(correctOptionIndex) || correctOptionIndex < 0 || correctOptionIndex >= options.length) {
      throw new Error(`AI qaytargan ${index + 1}-savol yaroqsiz.`);
    }
    return { prompt, type, options, correctOptionIndex };
  });
  return { title, description, questions };
}

export async function generateQuestions(topic, count) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    return {
      provider: "offline",
      title: `${topic} bo'yicha test`.slice(0, 120),
      description: `${topic} mavzusidagi bilimlarni sinab ko'ring.`.slice(0, 600),
      questions: fallbackQuestions(topic, count)
    };
  }

  const baseUrl = (process.env.AI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai/").replace(/\/$/, "");
  const request = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      model: process.env.AI_MODEL || "gemini-3.5-flash-lite",
      temperature: 0.9,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You create accurate, engaging quizzes in Uzbek from the user's topic or instructions. Return only JSON with this shape: {\"title\":string,\"description\":string,\"questions\":[{\"prompt\":string,\"type\":\"multiple\",\"options\":string[],\"correctOptionIndex\":number} or {\"prompt\":string,\"type\":\"text\",\"options\":[],\"correctOptionIndex\":null}]}. Write a relevant, concise title and description. Choose the most suitable type for each question: use multiple for objective questions with one verifiably correct answer; use text for explanation, reflection, or open-ended questions. Include both types when appropriate. Multiple-choice questions need 4 distinct options and a correctOptionIndex. Never invent facts, repeat ideas, or include an answer key for text questions."
        },
        {
          role: "user",
          content: `Foydalanuvchi so'rovi: ${topic}\nSavollar soni: aynan ${count}\nSavollarni shu so'rovga mos, aniq va o'zaro takrorlanmaydigan qilib tuz.`
        }
      ]
    })
  };
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(`${baseUrl}/chat/completions`, request);
    if (![429, 500, 502, 503, 529].includes(response.status) || attempt === 2) break;
    await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)));
  }

  if (!response.ok) {
    const errorText = await response.text();
    let providerMessage = errorText;
    try {
      const errorPayload = JSON.parse(errorText);
      providerMessage = errorPayload.error?.message || errorText;
    } catch {}
    providerMessage = String(providerMessage).replaceAll(apiKey, "[redacted]").slice(0, 400).trim();
    throw new Error(`AI xizmati xato qaytardi (${response.status})${providerMessage ? `: ${providerMessage}` : ""}.`);
  }
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI javobi bo'sh.");
  const parsed = JSON.parse(content);
  return { provider: "ai", ...validateQuiz(parsed, count, topic) };
}