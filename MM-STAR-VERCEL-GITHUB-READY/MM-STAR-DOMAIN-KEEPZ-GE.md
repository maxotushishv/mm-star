# MM STAR — mmstar.ge დომენი და Keepz

## 1. Vercel დომენი
- Vercel → mm-star → Settings → Domains → Add → `mmstar.ge`.
- სურვილისამებრ დაამატე `www.mmstar.ge` და ერთ-ერთი მთავარ მისამართად აირჩიე (რეკომენდებულია `mmstar.ge`).
- დომენის რეგისტრატორთან DNS ჩანაწერები დააყენე **ზუსტად Vercel-ის Domains ეკრანის ინსტრუქციის მიხედვით**. წაშალე ძველი Netlify-სთან კონფლიქტური A/CNAME ჩანაწერები მხოლოდ მას შემდეგ, რაც ახალ მნიშვნელობებს გადაამოწმებ. ელფოსტის MX/TXT ჩანაწერებს ნუ წაშლი.
- დაელოდე Vercel-ზე Valid Configuration-სა და HTTPS სერტიფიკატს. გადაამოწმე `https://mmstar.ge` და `https://mmstar.ge/api/...`.

## 2. Vercel გარემოს ცვლადები
- `PUBLIC_SITE_URL=https://mmstar.ge` (Production). შეინახე და Redeploy.
- Keepz-ს სჭირდება `KEEPZ_BASE_URL`, `KEEPZ_INTEGRATOR_ID`, `KEEPZ_RECEIVER_ID`, `KEEPZ_PUBLIC_KEY`/`KEEPZ_PUBLIC_KEY_GZ`, `KEEPZ_PRIVATE_KEY`/`KEEPZ_PRIVATE_KEY_GZ`, და არსებული `KEEPZ_IDENTIFIER` საჭიროების მიხედვით.
- გასაღებები არ ატვირთო GitHub-ში ან ZIP-ში და არ გამომიგზავნო.

## 3. Keepz დაბრუნება და callback
ამ ვერსიაში Keepz-ის შეკვეთის შექმნისას გამოიყენება `PUBLIC_SITE_URL` (და არა Request-ის Host):
- Callback: `https://mmstar.ge/api/keepz-callback`
- წარმატების დაბრუნება: `https://mmstar.ge/checkout.html?payment=success&intent=...`
- წარუმატებლობის დაბრუნება: `https://mmstar.ge/checkout.html?payment=failed&intent=...`

თუ Keepz-ის კაბინეტში ან პროვაიდერთან წინასწარ დაშვებული URL-ები/დომენებია, განაახლე ისინი. **მხოლოდ redirect არ ადასტურებს გადახდას** — საჭიროა Keepz-ის დაშიფრული სერვერული callback.

### უსაფრთხოების შესწორება
ადრე დაუშიფრავი callback payload-ის მიღება შეიძლებოდა; ახლა დაშიფვრა და წარმატებული დეშიფრაცია სავალდებულოა. უცნობი/შუალედური სტატუსი აღარ ათავისუფლებს მარაგს. ეს არის უსაფრთხოების გამკაცრება, მაგრამ ცოცხალი Keepz-გადახდის ტესტი საჭიროა, რადგან provider-ის რეალური webhook payload არ გვაქვს.

## 4. GitHub Actions (FINA)
GitHub → Settings → Secrets and variables → Actions → `MMSTAR_SITE_URL` მნიშვნელობა შეცვალე `https://mmstar.ge`-ით. `CRON_SECRET` უცვლელი და იგივე უნდა იყოს Vercel-ში. `FINA_STORE_ID=9`, მხოლოდ ნაშთების სინქრონიზაცია. დომენის ამუშავების შემდეგ ხელით გაუშვი Actions workflow.

## 5. ტესტი
1. დომენი იხსნება HTTPS-ით.
2. ჩვეულებრივი პროდუქტის checkout-ით სატესტო Keepz გადახდა: გადამისამართება, დაბრუნება და შეკვეთის PAID სტატუსი გადაამოწმე მხოლოდ რეალური პროვაიდერის დადასტურების შემდეგ.
3. წარუმატებელი გადახდა არ უნდა ჩაითვალოს PAID-ად.
4. FINA workflow Run workflow-ით შეამოწმე.

**მნიშვნელოვანი:** დომენი DNS-ში და Keepz-ის პროვაიდერის პარამეტრებში ამ ZIP-ის ატვირთვით ავტომატურად არ მიებმება. ამის გაკეთება შესაბამის პანელებშია საჭირო.
