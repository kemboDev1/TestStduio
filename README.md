# TestStudio

Psixolog amaliyoti uchun shaxsiy, guruhlar asosida ishlaydigan test va mijozlar javoblarini boshqarish platformasi. React/Vite interfeysi, Express API va PostgreSQL bazasidan foydalanadi.

## Imkoniyatlar

- Psixolog Admin sifatida guruhlar ochadi, nomlaydi va mijozlarga taklif kodi yuboradi.
- Admin ro‘yxatdan o‘tgan foydalanuvchini guruhga Tester yoki test tuzuvchi Creator sifatida qo‘shadi.
- Creator faqat o‘ziga biriktirilgan guruhlar uchun test tuzadi va AI yordamida mulohaza savollari tayyorlaydi.
- Tester taklif kodi bilan guruhga kirib, o‘z guruhidagi testlarni topshiradi.
- Javoblar boshqa mijozlarga ko‘rinmaydi. Guruh Admini va biriktirilgan Creator mijoz javoblarini ko‘ra oladi.
- Shkala va ochiq javob savollari o‘zini anglashga yordam beradi; AI tashxis qo‘ymaydi.
- Umumiy reyting jadvali yoki hamma uchun ochiq testlar yo‘q.
- Parollar bcrypt bilan himoyalanadi; profil rasmi, och/tungi mavzu va admin moderation boshqaruvi mavjud.

## Lokal ishga tushirish

1. PostgreSQL baza yarating.
2. Ishga tushirish muhiti uchun `DATABASE_URL` va kamida 32 belgili `SESSION_SECRET` belgilang. `.env` faylini GitHub’ga yuklamang.
3. Paketlarni o‘rnating va bazani sozlang:

   ```powershell
   npm install
   npm run db:setup
   ```

4. Lokal API va Vite serverini yoqing:

   ```powershell
   npm run dev
   ```

5. Birinchi hisobni yarating va uni Admin qiling:

   ```powershell
   npm run admin:promote -- foydalanuvchi_ismi
   ```

## Render va Vercel

- Render backend uchun `DATABASE_URL` va kamida 32 belgili `SESSION_SECRET` majburiy. Ilova ishga tushganda jadvallarga xavfsiz, takroran bajarish mumkin bo‘lgan yangilanishlarni qo‘llaydi.
- Vercel frontend `/api/*` so‘rovlarini Render’dagi backendga yo‘naltiradi (`vercel.json`).
- `NODE_ENV=production` Render’da ishlatiladi. `PGSSL=true` faqat PostgreSQL provayderi TLS talab qilsa qo‘shiladi. Render `PORT` qiymatini o‘zi beradi.
- `AI_API_KEY` generativ AI uchun ixtiyoriy. Ulanmaganida mulohaza shkala savollarining offline boshlang‘ich varianti ishlaydi. Mos OpenAI-compatible provayder kerak bo‘lsa, `AI_BASE_URL` va `AI_MODEL` ham ixtiyoriy.
- Deploydan keyin birinchi Admin foydalanuvchisini `npm run admin:promote -- foydalanuvchi_ismi` orqali belgilang.
