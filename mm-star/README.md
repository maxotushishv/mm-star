# MM STAR — 2026 storefront update

This package is intended to replace the current files in the existing GitHub/Netlify MM STAR project.

## Pages
- `index.html` — customer storefront
- `checkout.html` — separate checkout page
- `admin.html` — admin panel
- `dealer.html` — dealer portal
- `site.css` — shared responsive design
- `netlify/functions/api.mjs` — backend API

## Added in this update
- Light/red MM STAR design and hamburger side panel
- Store contact details and hours
- Customer languages: KA / EN / RU / TR
- Login/Register label changes to Profile after authentication
- Product photos in customer/dealer order history
- Georgian-capable PDF invoices (font is fetched by the server at invoice generation time)
- Category + subcategory hierarchy
- Category/product image URL and device upload using Netlify Blobs
- Product weight field
- Separate checkout page with visual payment and delivery cards
- Keepz card/installment flow
- Delivery tariff calculation by order weight
- Customer order creation and status SMS in the customer's selected language
- Dealer order creation/status SMS in the dealer portal language
- Admin CRUD: products, categories/subcategories, customers, dealers, customer orders, dealer orders
- Admin can delete orders; stock is restored when an order is deleted
- Admin editable store/contact settings
- ONWAY removed

## Delivery tariffs
The uploaded tariff sheet is built into the backend. Tbilisi delivery currently uses the sheet's `ქალაქი` tariff by weight. Regional delivery supports `რეგიონი`, `ცენტრალური ქალაქები`, `სოფელი`, `მაღალმთიანი`, and `თბილისის შემოგარენი`. Tbilisi district-specific rates can be added later when supplied.

## Existing Netlify environment variables
Keep the current Firebase, uBill, Keepz, admin username/password, and `APP_JWT_SECRET` variables. No ONWAY variables are used.

Recommended:
```
PUBLIC_SITE_URL=https://mm-star.netlify.app
KEEPZ_BASE_URL=https://gateway.keepz.me/ecommerce-service/api/integrator
```

## Deploy
Replace the existing repository files with this package, commit to `main`, and let Netlify redeploy. Because `package.json` now includes `@netlify/blobs`, Netlify will install it with the other function dependencies.


## 2026-08-29 UX & roles update
- Nested sidebar subcategories
- Product detail page + sale pricing
- OTP mobile UX
- Admin staff roles: admin / sales
- Sales role: dashboard + orders + status only
- Dealer category assignment is strict (empty assignment means no products)
- PDF Georgian font source corrected


## 2026-08-29 payment / sale hotfix
- Keepz callback/redirect URLs are set to https://mmstar.ge in the backend.
- Keepz card orders are not created until the server callback confirms payment.
- Invoice transfer orders use paymentStatus=AWAITING_CONFIRMATION and appear in Admin/Sales -> Pending Orders.
- Bank details default to Bank of Georgia / GE78BG0000000954382600 / company 434157066 and can be changed from Admin Settings.
- Checkout uses promotional effective prices.
- PDF uses Georgian font only for Georgian text and Helvetica for Latin/numbers to avoid square glyphs.
