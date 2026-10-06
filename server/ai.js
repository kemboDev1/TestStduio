const offlinePrompts = [
  "So'nggi paytda {topic} hayotingizga qanchalik ta'sir qildi?",
  "{topic} bilan bog'liq vaziyatda o'zingizni qanchalik xotirjam his qilasiz?",
  "{topic} yuzasidan o'z fikringizni yaqinlaringizga aytish sizga qanchalik oson?",
  "{topic} bo'yicha yordam yoki qo'llab-quvvatlash so'rash sizga qanchalik qulay?",
  "{topic}ni boshqarishda o'zingizdagi ijobiy o'zgarishlarni qanchalik sezyapsiz?",
  "{topic} bilan bog'liq qiyin paytlardan keyin o'zingizni tiklash uchun qancha vaqt kerak bo'ladi?",
  "{topic} haqida muloyim va hukmsiz suhbatlashish siz uchun qanchalik muhim?",
  "Bugun {topic} haqida gaplashishga qanchalik tayyormiz?",
  "{topic} bilan bog'liq kichik bir qadam tashlashni qanchalik uddalay olasiz?",
  "{topic} yuzasidan o'zingizni tushunilgan va eshitilgan deb qanchalik his qilasiz?"
];

const scaleOptions = ["Hech qachon", "Kamdan-kam", "Ba'zan", "Ko'pincha", "Deyarli har doim"];

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function fallbackQuestions(topic, count) {
  return shuffle(offlinePrompts).slice(0, count).map(template => ({
    prompt: template.replaceAll("{topic}", topic),
    type: "scale",
    options: scaleOptions,
    correctOptionIndex: null
  }));
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
    if (!prompt || !["multiple", "text", "scale", "yes_no"].includes(type)) {
      throw new Error(`AI qaytargan ${index + 1}-savol yaroqsiz.`);
    }
    if (type === "text") return { prompt, type, options: [], correctOptionIndex: null };
    if (type === "yes_no") return { prompt, type, options: ["Ha", "Yo‘q"], correctOptionIndex: null };
    const options = Array.isArray(item.options) ? item.options.map(option => String(option).trim().slice(0, 300)) : [];
    if (options.length < 2 || options.length > 8) {
      throw new Error(`AI qaytargan ${index + 1}-savol yaroqsiz.`);
    }
    return { prompt, type, options, correctOptionIndex: null };
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
          content: "You create clear, gentle self-reflection questionnaires in Uzbek for a psychologist's client groups. Return only JSON with shape {\"title\":string,\"description\":string,\"questions\":[{\"prompt\":string,\"type\":\"yes_no\",\"options\":[\"Ha\",\"Yo‘q\"],\"correctOptionIndex\":null} or {\"prompt\":string,\"type\":\"scale\",\"options\":string[],\"correctOptionIndex\":null} or {\"prompt\":string,\"type\":\"text\",\"options\":[],\"correctOptionIndex\":null} or {\"prompt\":string,\"type\":\"multiple\",\"options\":string[],\"correctOptionIndex\":null}]}. Prefer yes/no for clear reflection prompts, scale questions for frequency/current experience, and open text for optional reflection. Multiple-choice options are subjective and have no correct answer. Never score, grade, label personality or diagnose. Avoid leading or shaming language, treatment promises, and requests for trauma details. Never imply any answer proves a disorder. Return exactly the requested number of distinct questions, with concise title and description."
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
