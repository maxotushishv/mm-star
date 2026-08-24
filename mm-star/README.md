# MM STAR

GitHub/Netlify-ready MM STAR project.

Pages:
- `index.html` — Customer website only. No Admin/Dealer entry links are shown to customers.
- `admin.html` — separate Admin Panel login/page.
- `dealer.html` — separate Dealer Portal login/page.

Backend:
- Netlify Functions in `netlify/functions/`
- Firebase/Firestore configuration via environment variables
- Private API keys and Firebase Admin private key must never be committed to GitHub.

Deploy the repository through Netlify and add the required Environment Variables in Netlify settings.
