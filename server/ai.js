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

function validateQuestions(value, count) {
  if (!Array.isArray(value) || value.length !== count) {
    throw new Error("AI kutilgan sondagi savollarni qaytarmadi.");
  }
  return value.map((item, index) => {
    const prompt = String(item.prompt || "").trim().slice(0, 600);
    const options = Array.isArray(item.options) ? item.options.map(option => String(option).trim().slice(0, 300)) : [];
    const correctOptionIndex = Number(item.correctOptionIndex);
    if (!prompt || options.length < 2 || options.length > 6 || !Number.isInteger(correctOptionIndex) || correctOptionIndex < 0 || correctOptionIndex >= options.length) {
      throw new Error(`AI qaytargan ${index + 1}-savol yaroqsiz.`);
    }
    return { prompt, type: "multiple", options, correctOptionIndex };
  });
}

export async function generateQuestions(topic, count) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    return { provider: "offline", questions: fallbackQuestions(topic, count) };
  }

  const baseUrl = (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      model: process.env.AI_MODEL || "gpt-4o-mini",
      temperature: 0.9,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Create original, accurate quiz questions in Uzbek. Return only JSON: {\"questions\":[{\"prompt\":string,\"options\":string[],\"correctOptionIndex\":number}]}. Each question needs 4 distinct options and one verifiably correct answer. Vary question forms and avoid repeating ideas."
        },
        {
          role: "user",
          content: `Mavzu: ${topic}\nSavollar soni: ${count}\nQiziqarli, aniq va yoshga mos savollar tuz.`
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`AI xizmati xato qaytardi (${response.status}).`);
  }
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI javobi bo'sh.");
  const parsed = JSON.parse(content);
  return { provider: "ai", questions: validateQuestions(parsed.questions, count) };
}