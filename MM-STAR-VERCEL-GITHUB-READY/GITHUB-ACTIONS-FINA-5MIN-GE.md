# MM STAR — FINA 5-წუთიანი ავტომატური სინქრონიზაცია (Vercel Hobby)

Vercel Hobby-ს არ შეუძლია 5-წუთიანი Cron Jobs. ამ ვერსიაში `vercel.json`-იდან `crons` ამოღებულია და დამატებულია GitHub Actions: `.github/workflows/fina-stock-sync.yml`.

## დაყენება
1. ეს განახლებული პროექტი ატვირთეთ **იმავე GitHub რეპოზიტორიის default branch-ზე**, რომელიც Vercel-ს უკავშირდება. Vercel-ის Redeploy შემდეგ Hobby Cron-ის შეცდომა გაქრება.
2. Vercel → Settings → Environment Variables: შეამოწმეთ `FINA_ENABLED=true`, `FINA_AUTO_SYNC=true`, `FINA_STORE_ID=9`, `FINA_LOGIN`, `FINA_PASSWORD`, `FINA_API_URL` და ძლიერი `CRON_SECRET`. ცვლილების შემდეგ Redeploy.
3. GitHub → Repository → Settings → Secrets and variables → Actions → New repository secret:
   - `MMSTAR_SITE_URL` = `https://mm-star.vercel.app` (ან საკუთარი საიტის **HTTPS** მისამართი, ბოლოდან `/` აუცილებელი არ არის).
   - `CRON_SECRET` = **ზუსტად იგივე** მნიშვნელობა, რაც Vercel-ის `CRON_SECRET`-შია.
4. GitHub → Actions → **FINA stock sync (every 5 minutes)** → Run workflow. გადაამოწმეთ, რომ დასრულდეს მწვანედ.
5. დაგეგმილი გაშვებები გამოჩნდება Actions-ის ისტორიაში. GitHub-ის schedule არის **სავარაუდო ინტერვალი**, დატვირთვის დროს შეიძლება დაგვიანდეს ან გამოტოვოს გაშვება; არ არის გარანტირებული ზუსტად ყოველ 5 წუთში.

## რას აკეთებს
- სერვერული endpoint: `GET /api/cron/fina-sync`
- Header: `Authorization: Bearer <CRON_SECRET>`
- ავტომატური რეჟიმი: მხოლოდ `stock` (რაოდენობა), ფასები და აღწერები არ იცვლება.
- საწყობი: `FINA_STORE_ID=9` — ILHAMA. მეორე საწყობი არ დამატებულა.
- ერთდროული სინქრონიზაცია Firestore lock-ით იზღუდება.

## შენიშვნები
- საიდუმლო გასაღებები არ ჩაწეროთ GitHub-ის ფაილებში, შეტყობინებებში ან სკრინშოტებში.
- FINA API თუ მხოლოდ HTTP-ზეა, Vercel → FINA ავტორიზაცია დაუშიფრავია. გამოიყენეთ HTTPS ან დაცული ტუნელი.
- FINA-ს დიდი კატალოგის გამო Vercel Function timeout შეიძლება ცალკე პრობლემად დარჩეს; თუ Actions-ში timeout/500 ჩანს, საჭიროა API-ის ოპტიმიზაცია ან გარე worker.
- Github Actions-ის უფასო წუთების ლიმიტები და გეგმის პირობები მოქმედებს; public repository-ს inactivity-ს დროს schedule შეიძლება გაითიშოს.
