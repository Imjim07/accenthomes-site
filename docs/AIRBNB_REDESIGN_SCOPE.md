# Accent Homes — Airbnb-Style Redesign Scope

**Created:** July 24, 2026
**Author:** Yeh (Capricorn Hub)
**Client:** Mr Joe / Accent Homes
**Timeline:** One week, self-paced (target completion: July 31, 2026)
**Constraint:** Backend untouched — this is a UI-layer redesign only

---

## Context & Motivation

Mr Joe has requested an Airbnb-style redesign of the booking UI after walking through the current dark editorial site. He specifically named Airbnb as the reference. He also agreed to a white + ash + lilac color direction as a departure from the current dark theme.

This scope covers the visual and interaction redesign of the guest-facing surfaces (homepage listing cards, property detail modal, booking modal) while preserving the working backend integrations (Firebase, Paystack, Cloud Functions, adminCreateBooking, admin panel).

**What we are copying from Airbnb:**
- Structural design patterns (photo-first cards, sticky booking bar, modest typography, soft radii, one-shadow depth)
- Component structure (property card layout, reservation card structure, date picker cells, guest stepper)
- Whitespace and hierarchy philosophy (photography does visual heavy lifting, type stays quiet)

**What we are NOT copying:**
- Airbnb's brand palette (Rausch red, white canvas) — we use our own colors
- Airbnb's proprietary typeface (Cereal) — we use Hanken Grotesk
- Airbnb's full feature set — Accent Homes has 4 properties, not millions

---

## Design System

### Color Palette

| Token | Hex | Role |
|-------|-----|------|
| `--canvas` | `#FFFFFF` | Default page background |
| `--surface-soft` | `#F7F7F7` | Cards, disabled fields, subtle fills |
| `--surface-strong` | `#EFEFEF` | Slightly heavier fill (icon buttons, badges) |
| `--hairline` | `#DDDDDD` | Default 1px border |
| `--hairline-soft` | `#EBEBEB` | Softer divider |
| `--ink` | `#222222` | Primary text, headings |
| `--body` | `#3F3F3F` | Long-form body text |
| `--muted` | `#6A6A6A` | Sub-labels, captions, meta text |
| `--muted-soft` | `#929292` | Disabled text |
| `--lilac` | `#9C6EA6` | Primary CTA background (deepened from #C8A2C8 for WCAG AA contrast) |
| `--lilac-active` | `#7F5589` | Press/pointer-down state for CTAs |
| `--lilac-disabled` | `#D4C0DA` | Pale tint for disabled CTAs |
| `--lilac-soft` | `#C8A2C8` | Accent/decorative use only (badges, dividers, backgrounds) |
| `--on-primary` | `#FFFFFF` | Text on lilac buttons |
| `--error` | `#C13515` | Form validation errors |
| `--scrim` | `rgba(0,0,0,0.5)` | Modal backdrop |

**Usage rule:** Lilac is used sparingly. Most surfaces are 90% white/ash + ink text. One or two lilac moments per screen — the primary CTA, sometimes an active state or accent. Not a background wash, not decorative overuse.

### Typography

**Family:** Hanken Grotesk (already in use for Capricorn Hub — extended to Accent Homes).

**Fallback stack:** `'Hanken Grotesk', -apple-system, system-ui, 'Helvetica Neue', sans-serif`

| Token | Size | Weight | Line Height | Use |
|-------|------|--------|-------------|-----|
| `display-xl` | 32-36px | 500 | 1.2 | Hero titles, homepage h1 |
| `display-lg` | 24-26px | 500 | 1.25 | Listing detail h1 |
| `display-md` | 22px | 600 | 1.25 | Section heads |
| `display-sm` | 20px | 600 | 1.3 | Sub-section titles |
| `title-md` | 17px | 500 | 1.3 | Card titles |
| `title-sm` | 15px | 500 | 1.3 | Compact card titles |
| `body-md` | 16px | 400 | 1.5 | Default running text |
| `body-sm` | 14px | 400 | 1.4 | Meta lines, dates, prices |
| `caption` | 13px | 500 | 1.3 | Field labels, small labels |
| `caption-sm` | 12px | 400 | 1.3 | Footer legal, micro text |
| `button-md` | 16px | 500 | 1.25 | Primary CTA labels |
| `button-sm` | 14px | 500 | 1.3 | Secondary/pill button labels |
| `rating-display` | 56-64px | 700 | 1.1 | Rating number ONLY — the one "loud" typographic moment |

**Weight philosophy:** Display weights are modest (500-600, not 700+). Type is quiet. Photos and content carry visual weight. The one exception is the rating display which uses 700 weight at large size.

### Shape Language

| Token | Value | Use |
|-------|-------|-----|
| `rounded-xs` | 4px | Micro elements |
| `rounded-sm` | 8px | Buttons, inputs |
| `rounded-md` | 14px | Cards, images |
| `rounded-lg` | 20px | Larger surfaces |
| `rounded-xl` | 32px | Pills, category tabs |
| `rounded-full` | 9999px | Search bar, icon buttons, wishlist heart |

**Rule:** No hard corners on interactive elements. Everything gets soft radii. Only the body grid itself may have straight edges.

### Elevation

**One shadow tier:**
```css
--shadow-card: 0 0 0 1px rgba(0,0,0,0.02),
               0 2px 6px 0 rgba(0,0,0,0.04),
               0 4px 8px 0 rgba(0,0,0,0.10);
```

Applied to: card hover states, floating dropdowns (date picker, guest picker), sticky booking bar.

Everything else is flat. No progressive elevation tiers. Depth comes from whitespace and rounded clipping, not stacked shadows.

### Spacing System

Base unit: 4px

`--space-xxs` 2px · `--space-xs` 4px · `--space-sm` 8px · `--space-md` 12px · `--space-base` 16px · `--space-lg` 24px · `--space-xl` 32px · `--space-xxl` 48px · `--space-section` 64px

---

## Sequenced Ship Plan

### Day 1 (Saturday, July 24) — Design System Foundation

**Ship:** CSS variable overhaul in `accent-main/index.html` — replace current dark-theme palette with the new white+ash+lilac system. Update the `:root` variable block.

**Success criteria:**
- All existing components still render (may look wrong visually, but no broken layouts)
- New tokens available for use in Days 2-5
- Deploy to preview URL, verify site loads without JS errors

**Estimated time:** 2-3 hours

### Day 2 (Sunday, July 25) — Property Card Rebuild

**Ship:** New Airbnb-style property card component.

**Specifics:**
- 1:1 aspect ratio photo container
- 14px corner clipping on image
- "Available" pill badge floating top-left (using lilac-soft as background, ink text)
- Heart icon top-right (32×32px circle, ash background, ink outline default, lilac fill when saved)
- Below image: title (title-md), location (body-sm muted), price ("₦X / night" body-sm ink, right-aligned)
- Card hover applies one-shadow tier
- Tapping card opens property detail modal (existing behavior preserved)

**Success criteria:**
- Homepage shows 4 property cards in new style
- Cards remain fully functional (link to detail modal)
- No regression in listings loading
- Deploy to preview, verify on real phone

**Estimated time:** 4-5 hours

### Day 3 (Monday, July 26) — Booking Modal Rebuild [PRIORITY]

**Ship:** New Airbnb-style booking modal (the client's specific ask).

**Specifics:**
- Modal opens from Reserve CTA on property card
- Header: property name (title-md), location (body-sm muted), price (body-sm right-aligned)
- Two-step flow: Details → Payment
- Date picker: 40×40px circular day cells, ink fill on selection, soft-ash range lozenge between selected days
- Guest count: stepper with +/- buttons (not dropdown)
- Full name, email, phone: 56px text inputs, hairline outline, floating labels
- Notes/message field: multi-line text area
- Primary CTA at bottom: "Reserve" lilac button, full-width, 48px height, 8px radius, white label
- On mobile: sticky bottom bar carrying price summary + Reserve CTA (Airbnb pattern)

**Success criteria:**
- Full booking flow works end-to-end with real Paystack test
- Modal follows Airbnb structural patterns
- Mr Joe can see the change during a walkthrough
- Deploy to preview, verify on real phone AND desktop

**Estimated time:** 6-8 hours

**This is the checkpoint to message Mr Joe.** Send him the preview URL after this ships. Real evidence of progress in the direction he asked for.

### Day 4 (Tuesday, July 27) — Property Detail Modal Rebuild

**Ship:** New Airbnb-style property detail view.

**Specifics:**
- Photo banner at top: single-image hero with next/prev arrows and dot indicator
- "1/14" indicator in bottom-right of photo
- Below photo: property title (display-lg), location (body-md muted)
- "What this place offers" section: 1-column amenity list on mobile, 2-column on desktop, 24×24px icon + label
- Description block: body-md text, 3-line truncation with "Show more" tertiary link
- Price display: ₦X per night (display-md), "+ ₦X caution (refundable)" line beneath (body-sm muted)
- Reserve CTA: sticky bottom bar on mobile, right rail on desktop

**Success criteria:**
- Property detail modal reflects new visual system
- All property data still displays correctly
- Sticky booking bar works on mobile scroll
- Deploy to preview, verify on real phone

**Estimated time:** 5-6 hours

### Day 5 (Wednesday, July 28) — Homepage Hero & Nav Polish

**Ship:** Hero section and top navigation redesign.

**Specifics:**
- Hero: reduce dark theme, use white background with property showcase photo
- Top nav: transparent-to-white on scroll, ink text
- "Browse Residences" CTA: pill-shaped lilac button
- Bottom nav (mobile): keep existing structure, update colors to match new palette

**Success criteria:**
- Hero feels aligned with rest of site
- Nav consistent across scroll states
- Deploy to preview, verify

**Estimated time:** 3-4 hours

### Day 6-7 (Thursday-Friday, July 29-30) — Buffer, Bug Fixes, Testing

**Ship:** Whatever slipped from Days 1-5, plus:
- Cross-device testing (multiple real phones)
- Fix any regressions from the redesign
- Reach out to Mr Joe for feedback session
- Prepare a walkthrough script for the follow-up call

- **Dark mode redesign:** update 200+ hardcoded component rules in [data-theme="dark"] to match new lilac/white/ash system. Includes .bento-card, .footer-col, .pay-modal, .apt-modal, .mobile-menu-inner, .contact-panel, and all other component-specific dark overrides.

---

## Constraints (Do Not Cross)

- **Backend files untouched:** `functions/index.js`, `firestore.rules`, `firebase.json`, `functions/package.json`
- **Data schema untouched:** `listings`, `bookings`, `guestProfiles`, `admin_audit_log` field structures
- **Backend logic untouched:** `getListings()`, `saveBooking()`, `openPay()`, Paystack integration internals
- **Admin panel untouched:** `accent-main/accent-admin.html` stays as-is
- **Working flow preserved:** Every UI change must still route through the existing Paystack payment flow

---

## Testing Discipline

**Every ship follows this cycle:**
1. Diff first, verify locally
2. Deploy to preview URL (`https://preview.accenthomes.pages.dev`)
3. Test on real phone (not DevTools emulation)
4. Test in desktop browser
5. If both work → promote to production
6. If either fails → do not promote, diagnose

**No shortcuts. No "done and deployed" without verification. Every day.**

---

## Success Criteria for the Week

By end of Friday, July 30:
- Site visually matches the white/ash/lilac Airbnb-style direction Mr Joe agreed to
- Booking flow specifically redesigned per his direct feedback
- Backend integrity preserved — no regressions in Paystack, Firebase, or admin flow
- Preview URL discipline maintained throughout — no direct-to-production deploys
- Mr Joe has been shown at least one preview and given feedback

---

## What This Scope Does Not Cover

- Carousel swipe bug on mobile (existing issue, defer)
- Intermittent listings-load bug (existing issue, defer — needs separate diagnostic)
- Intermittent modal-render bug 1-in-20 (existing issue, defer)
- Browser back button behavior (existing issue, defer)
- Airbnb search functionality, filters, wishlists — Accent Homes has 4 properties, doesn't need them
- Airbnb category tabs, experiences, services — not applicable
- Reviews system rebuild — separate future work
- Multi-language switching UI polish — existing i18n stays as-is
- Individual admin accounts for Mr Joe and Ebere — separate follow-up work


- **Dark mode visual consistency during Day 1-5:** dark mode will look visually mixed (new lilac accents on old bronze-era dark rules) until Day 6-7 completes the dark mode pass. This is a known temporary state, not a bug.