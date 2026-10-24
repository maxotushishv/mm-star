# MM STAR — Vercel + GitHub ინსტრუქცია

## ატვირთვა
1. ZIP გაშალე. **ამ ZIP-ის შიგნით არსებული ფაილები** უნდა მოხვდეს GitHub-ის არსებულ `mm-star/` საქაღალდეში (არ შექმნა კიდევ ერთი `mm-star/`).
2. GitHub-ში ძველი `mm-star/netlify/` საქაღალდე შეგიძლია დატოვო, მაგრამ Vercel მას არ იყენებს. მნიშვნელოვანია, რომ ახალი `api/`, `lib/`, `vercel.json`, `package.json` და HTML ფაილები ერთსა და იმავე `mm-star/` საქაღალდეში იყოს.
3. Vercel → Add New → Project → Import Git Repository → `maxotushishv/mm-star`.
4. **Root Directory: `mm-star`** (ეს ყველაზე მნიშვნელოვანია). Framework Preset: **Other**. Build Command: **ცარიელი / Override OFF**. Output Directory: **ცარიელი / Override OFF**. Install Command: default.
5. Vercel → Settings → Environment Variables: Netlify-ის მოქმედი ცვლადები გადაიტანე **ორიგინალი მნიშვნელობებით**, მათ შორის `FIREBASE_PRIVATE_KEY`, `KEEPZ_PRIVATE_KEY`, `KEEPZ_PUBLIC_KEY`. დიდი გასაღებების შეკუმშვა აღარ არის საჭირო. ცვლადები GitHub-ში არ ჩაწერო.
6. Vercel → Storage → Create → Blob → **Public**; დააკავშირე პროექტთან. ამის შედეგად `BLOB_READ_WRITE_TOKEN` უნდა გაჩნდეს Vercel Environment Variables-ში. აუცილებელია ადმინისტრატორის ფოტოების ატვირთვისთვის.
7. `PUBLIC_SITE_URL` მიუთითე ახალ Vercel მისამართზე (`https://...vercel.app`), რომ Keepz callback/redirect სწორად გენერირდეს. Keepz-ის მხარესაც შესაძლოა callback დომენის შეცვლა იყოს საჭირო.
8. ჯერ `FINA_ENABLED=false` დატოვე; საიტის API შეამოწმე `https://<domain>/api/health` და კატალოგი `https://<domain>/api/catalog`.
9. FINA-ს სერვერის HTTP მისამართზე ავტორიზაციის მონაცემები **არ გაუშვა**; ჯერ HTTPS/VPN გვჭირდება. შემდეგ დააყენე `FINA_ENABLED=true`, `FINA_API_URL`, `FINA_LOGIN`, `FINA_PASSWORD`, `FINA_STORE_ID`.
10. Vercel GitHub-ზე ყოველი ახალი commit-ისას ავტომატურად გააკეთებს Deploy-ს.

## რა არის გადატანილი
- ონლაინ მაღაზია, ადმინ პანელი, დილერის პორტალი, შეკვეთები, Keepz/UBILL, Firebase Firestore.
- `/api/*` მარშრუტები Vercel Function-ზე მუშაობისთვის გადაკეთებულია.
- FINA-ს ხელით lookup / preview / sync კოდი შენარჩუნებულია. **10-წუთიანი ავტომატური სინქრონიზაცია ამ ვერსიაში არ არის**.
- სურათების ახალი ატვირთვა Vercel Blob-ზე გადავიდა. Vercel-ის 4.5 MB request body შეზღუდვის გამო ერთი სურათი მაქსიმუმ ~3 MB უნდა იყოს (სერვერის გავლით).

## ძველი სურათები
ძველ Netlify Blobs-ში არსებული სურათები ავტომატურად არ გადადის Vercel Blob-ში. თუ ძველი წარმატებული Netlify Deploy კვლავ ემსახურება `/api/media/...` მისამართებს, შეგიძლია მიუთითო `LEGACY_NETLIFY_SITE_URL=https://<your-old-site>.netlify.app` (დომენი გადაამოწმე). ეს დროებითი fallback-ია. გრძელვადიანად სურათები უნდა გადაიტანო Vercel Blob-ში ან თავიდან ატვირთო.

## შეზღუდვები
ეს არის კოდის ადაპტაცია. Vercel-ზე რეალური Deploy, Firebase/Keepz გადახდები და FINA-ის რეალურ სერვერთან კავშირი ჯერ არ შემოწმებულა. პროექტი არ უნდა ჩაითვალოს production-verified-ად ტესტირების გარეშე.
