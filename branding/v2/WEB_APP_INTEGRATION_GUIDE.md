# Optionyze web app branding integration guide

Target web app:

- `D:\NodeJS\Optionyze`

Prepared assets from this repo:

- `branding/v2/shared/favicon-16.png`
- `branding/v2/shared/favicon-32.png`
- `branding/v2/shared/apple-touch-icon.png`
- `branding/v2/shared/android-chrome-192.png`
- `branding/v2/shared/android-chrome-512.png`
- `branding/v2/shared/optionyze-logo-v2-master-square.png`
- `branding/v2/shared/optionyze-logo-v2-master-transparent.png`

## 1. Copy assets into the web app public folder

Suggested destination inside `D:\NodeJS\Optionyze\public\brand\`:

- `favicon-16.png`
- `favicon-32.png`
- `apple-touch-icon.png`
- `android-chrome-192.png`
- `android-chrome-512.png`
- `optionyze-logo-square.png`
- `optionyze-logo-transparent.png`

## 2. Add browser icon links in page heads

Add this block inside the `<head>` of pages that render full HTML:

```html
<link rel="icon" type="image/png" sizes="16x16" href="/brand/favicon-16.png" />
<link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32.png" />
<link rel="apple-touch-icon" sizes="180x180" href="/brand/apple-touch-icon.png" />
<link rel="manifest" href="/brand/site.webmanifest" />
```

Suggested files based on the current project structure:

- `src/views/home.ejs`
- `src/views/signin.ejs`
- `src/views/signup.ejs`
- `src/views/dashboard.ejs`
- `src/views/covered-options.ejs`
- `src/views/rolling-futures-lt-dual.ejs`
- `src/views/options-scalper.ejs`
- `src/views/directional-options.ejs`
- `src/views/account-profile.ejs`
- `src/views/account-delta-api.ejs`
- `src/views/change-password.ejs`
- `src/views/mngusers.ejs`
- `src/views/survival-admin-signin.ejs`
- `src/views/survival-admin-dashboard.ejs`
- `src/views/survival-admin-running-users.ejs`

## 3. Add a web manifest

Create `public/brand/site.webmanifest`:

```json
{
  "name": "Optionyze",
  "short_name": "Optionyze",
  "icons": [
    {
      "src": "/brand/android-chrome-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/brand/android-chrome-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ],
  "theme_color": "#091017",
  "background_color": "#091017",
  "display": "standalone"
}
```

## 4. Replace letter-only brand marks with the shared logo

Current files using text or single-letter placeholders:

- `src/views/home.ejs`
- `src/views/signin.ejs`
- `src/views/signup.ejs`
- `src/views/survival-admin-signin.ejs`
- `src/views/survival-admin-dashboard.ejs`
- `src/views/survival-admin-running-users.ejs`
- `src/views/partials/app-header.ejs`

Replace placeholder spans like:

```html
<span class="brand-mark">O</span>
```

or

```html
<span class="app-mark">O</span>
```

with:

```html
<img src="/brand/optionyze-logo-transparent.png" alt="Optionyze logo" class="brand-logo" />
```

## 5. Add shared image sizing styles

For files using inline styles such as `home.ejs`, `signin.ejs`, and `signup.ejs`, add:

```css
.brand-logo {
    width: 42px;
    height: 42px;
    object-fit: contain;
    display: block;
}
```

For the app shell header in `public/css/app-shell.css`, replace `.app-mark` usage with:

```css
.app-brand {
    display:flex;
    align-items:center;
    gap:12px;
    color:var(--app-text);
    text-decoration:none;
    font-weight:700;
    letter-spacing:.18em;
    font-size:.95rem;
}

.app-brand-logo {
    width:40px;
    height:40px;
    object-fit:contain;
    display:block;
}
```

Then update `src/views/partials/app-header.ejs` to:

```html
<a class="app-brand" href="/">
    <img class="app-brand-logo" src="/brand/optionyze-logo-transparent.png" alt="Optionyze logo" />
    <span>OPTIONYZE</span>
</a>
```

## 6. Keep the visual system aligned

The v2 mark was designed to match the current dark product palette:

- background: `#091017`
- deep navy logo stroke
- rust-orange action accent

That means the current web surfaces can keep their existing dark backgrounds and simply swap the placeholder brand marks for the new logo.
