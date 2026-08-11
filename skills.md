---
name: bgn-web-design-system
version: "1.3.22"
description: >
  A formal design-system skill for creating, revising, and reviewing
  Biznet Gio Nusantara public-facing web experiences. Use this skill for
  public websites, product pages, pricing pages, promotional pages, support
  pages, and documentation surfaces that must follow the BGN visual language.
---

# BGN Web Design System Skill

Use this guide as a normative source for layout, typography, color, logo usage,
component behavior, content tone, and implementation details. The design system
is optimized for Indonesian cloud infrastructure products, but all interface
copy and design-system documentation must be written in formal English unless a
specific page explicitly requires Indonesian customer-facing copy.

## 1. Core Principles

1. **Trust First**  
   Specific evidence is stronger than generic claims. Prefer measurable signals
   such as `99.9% SLA`, `400k+ users`, verified client logos, security
   certifications, data-center references, and uptime indicators.

2. **Clarity Over Cleverness**  
   A visitor must understand the offer, CTA, and price within three seconds.
   Avoid ambiguous metaphors, decorative copy, and vague enterprise language.

3. **Indonesian Market Context**  
   Use Rupiah pricing and Indonesian business context where relevant. Preserve
   standard technical English terms such as VPS, Kubernetes, GPU, bandwidth,
   storage, and workload.

4. **One Green, One Meaning**  
   `--color-primary-700` is reserved for primary interactive elements such as
   CTAs, active navigation, links, and feature icons. Do not use it as generic
   decoration.

5. **Scalable Tokens**  
   Use the approved design tokens. Do not introduce arbitrary spacing, color,
   radius, typography, or shadow values unless the system is intentionally
   extended.

6. **Performance Is Design**  
   Keep LCP below three seconds on a 4G connection. Motion must support
   orientation or feedback, not decoration.

## 1.1 LLM Implementation Contract

LLM-based work must follow this contract before changing any BGN web design:

1. Read `skills.md` for design-system rules.
2. Read `design-tokens/bgn.tokens.json` or query the MCP server before choosing
   visual values.
3. Use the Nuxt application structure as the implementation target:
   `app.vue`, `nuxt.config.ts`, `tailwind.config.ts`, and `assets/css/*`.
4. Use official templates and Resources guidance instead of starting from a
   blank screen.
5. Record meaningful design-system changes in `changelog.md`.

Agents must not invent colors, spacing, logo variants, component dimensions, or
layout primitives when a token or template already exists.

## 2. Design Tokens

The canonical machine-readable token source is:

`<BGN_DS_ROOT>/design-tokens/bgn.tokens.json`

The CSS export is:

`<BGN_DS_ROOT>/design-tokens/bgn.tokens.css`

The CSS exports are generated from JSON and must not be edited manually:

```bash
npm run tokens:build
npm run tokens:check
```

Nuxt consumes the CSS export globally through:

`<BGN_DS_ROOT>/assets/css/tokens.css`

Tailwind consumes the same token values through:

`<BGN_DS_ROOT>/tailwind.config.ts`

`<BGN_DS_ROOT>` means the root directory of the BGN DS project on the server or
developer machine where the design system is running. Documentation and agent
instructions must not hardcode a maintainer-specific local path.

Deployment URL values are configured through environment variables:

```dotenv
NUXT_PUBLIC_SITE_URL=https://design-system.example.com
NUXT_APP_BASE_URL=/
NUXT_PUBLIC_ASSET_BASE_URL=
```

Use `NUXT_PUBLIC_SITE_URL` for the deployed domain. Use `NUXT_APP_BASE_URL` for
the Nuxt base path, such as `/` for root deployment or `/bgn-ds/` for subpath
deployment. Use `NUXT_PUBLIC_ASSET_BASE_URL` only when public assets are served
from a separate CDN or asset domain. Do not hardcode deployment domains or asset
base URLs in source files.

### 2.1 Color Tokens

```css
--color-primary-900: #06583A; /* pressed states for dark buttons */
--color-primary-800: #0B714D; /* pressed and focused primary controls */
--color-primary-700: #118D62; /* main brand color for CTAs, links, icons, and active nav */
--color-primary-600: #29AE87; /* hover and focus states for primary controls */
--color-primary-500: #46E1B4; /* pressed states for light controls */
--color-primary-400: #78FFCF; /* hover and focus states for light controls */
--color-primary-300: #B5FFE5; /* subtle brand surfaces */
--color-primary-200: #D4F6E9; /* very subtle brand containers */
--color-primary-100: #E6F5EE; /* badge backgrounds and subtle brand callouts */

--color-neutral-900: #101211; /* titles, primary text, emphasis, dark buttons */
--color-neutral-800: #2F3E43; /* high-emphasis secondary surfaces */
--color-neutral-700: #55636B; /* body text and secondary text */
--color-neutral-600: #7F8B96; /* secondary icons and compact metadata */
--color-neutral-500: #939EAB; /* muted text and placeholder text */
--color-neutral-400: #B9C4CE; /* disabled content */
--color-neutral-300: #DCE3EA; /* input borders, subtle borders, dividers */
--color-neutral-200: #ECF1F6; /* disabled input fields and muted surfaces */
--color-neutral-100: #F9FBFD; /* light backgrounds and secondary card surfaces */
--color-neutral-0:   #FFFFFF; /* primary card surfaces and light buttons */

--color-text-primary: #101211; /* headings and primary text */
--color-text-body: #55636B; /* default long-form body copy */
--color-text-secondary: #7F8B96; /* supporting copy, captions, section labels */
--color-text-muted: #939EAB; /* metadata and helper text only */
--color-text-disabled: #B9C4CE; /* disabled text only */

--color-warning: #FDB72A;
--color-warning-bg: #FFF9E7;
--color-warning-text: #8A5A00;
--color-error: #C61A0B;
--color-error-bg: #FEECEC;
--color-error-text: #C62828;
--color-info: #42A5F5;
--color-info-bg: #EAF4FF;
--color-info-text: #1565C0;
```

Color rules:

- Use primary green only for interaction and state.
- Pair semantic color with a text label or icon. Never rely on color alone.
- Use white text on `--color-primary-700` for primary CTAs.
- Use `--color-text-body` or `--color-neutral-700` for readable paragraphs.
- Do not use `--color-neutral-500` or lighter for body copy; reserve it for metadata, placeholders, helper text, or disabled states.
- Navigation and side-menu labels require stronger hierarchy than metadata: use `--color-neutral-700` for default items and child items, `--color-neutral-600` for section labels, disclosure icons, inactive child dots, and footer metadata. Do not use `--color-neutral-400` or `--color-neutral-500` for readable navigation text.
- Use neutral backgrounds for page sections and card surfaces.
- Use `border.default` / `Neutral 300` for visible surfaces, cards, shell rails, tables, form controls, pricing blocks, and documentation preview containers. `Neutral 200` is too faint for default component outlines.
- Reserve `border.subtle` / `Neutral 200` for quiet internal separators and disabled-field surfaces only. Use `border.divider` / `Neutral 100` for repeated row dividers where a stronger border would add noise.
- When implementing specific surfaces, prefer role tokens before raw semantic
  tokens: `component.surface.borderColor`, `component.shell.borderColor`,
  `component.table.borderColor`, and `component.control.borderColor` all resolve
  to Neutral 300 and document the intended use.
- In design-system documentation pages, palette cards, preview containers, tables, and shell rails use `border-n-300`, 14px readable support copy, and `Primary 500` is marked as the displayed default swatch while `Primary 700` remains the main action color.

Sidebar component tokens:

```text
component.sidebar.sectionLabelColor -> #7F8B96 / N600
component.sidebar.itemColor -> #55636B / N700
component.sidebar.childItemColor -> #55636B / N700
component.sidebar.iconColor -> #7F8B96 / N600
component.sidebar.footerColor -> #7F8B96 / N600
```

### 2.1.1 Product UI Dashboard Tokens

Use these rules for dense customer dashboards, admin dashboards, infrastructure
monitoring, pricing management, and governance workflows.

- Product pages keep Geist as the primary UI font. Inter and system-ui are
  fallbacks only.
- Page titles use 24px / 1.25 / 600. Section and card titles use 18-20px /
  1.3 / 600.
- Table cells, controls, dropdown options, selected values, resource names,
  region names, cluster names, server names, worker names, network names, and
  plan names default to weight 400.
- Form label typography and form control value typography are separate roles.
  Textual controls must never become semibold because they sit inside a
  semibold label.
- Do not use unqualified `font: inherit` on `input`, `select`, or `textarea`
  when a semibold label can be the nearest parent. If the UI font family is
  inherited, explicitly reset value weight to 400 afterward.
- Textual input, search, email, URL, password, number, date, textarea, selected
  select values, native option text, placeholder pseudo-elements,
  autocomplete-filled values, and selected filenames use weight 400. File-picker
  action buttons may remain semibold.
- Use `font.lineHeight.ui` for labels, controls, navigation, tabs, and table
  cells. Use `font.lineHeight.body` for helper and description text.
- Use `density.compact.*`, `density.default.*`, and
  `density.comfortable.*` before inventing control heights, row heights, or
  panel padding.
- Use `layout.pageGap`, `layout.sectionGap`, and `layout.inlineGap` for
  dashboard alignment. Avoid vertical gaps larger than 24px inside dashboard
  content unless separating major page regions.
- Every interactive element must expose explicit default, hover,
  active/selected, focus-visible, disabled, and open/expanded states.
- Focus-visible uses `focus.ring.color`, `focus.ring.width`, and
  `focus.ring.offset`.
- Secondary tabs organize related content within a content area. They do not
  replace top-level navigation or app-wide section changes. Use
  `component.tab.secondary.*` tokens for compact in-page tab sets.
- Tab typography is state-invariant. Default, hover, focus-visible, pressed,
  selected, and disabled tabs keep the same `component.tab.secondary`
  font-family, font-size, font-weight, line-height, and letter spacing. State
  changes may affect only label color, the selected indicator, and the
  state-layer opacity.
- Tabs must expose a pressed state on pointer down/tap. Pressed feedback uses
  `component.tab.pressed.stateLayerColor` from the existing BGN color tokens,
  transitions with `component.tab.pressed.duration`, and must not shift tab
  height, indicator position, typography, or surrounding layout.
- Tab pressed state must use square corners. Do not let the pressed state layer
  inherit the selected indicator radius or tab container radius.
- Tab documentation examples use a stacked structure: preview first,
  implementation notes below. Do not place notes in a narrow side column where
  token paths or explanatory copy can overflow into the card boundary.
- Every tab in one tablist uses consistent default, hover, focus-visible,
  pressed, selected, and disabled styling. Switching tabs changes the panel
  content without moving the tablist vertically.
- Product side navigation active state must combine a subtle green background,
  green text/icon, and a narrow left indicator. Do not represent active state
  with text color alone.
- Navigation groups expand and hide independently. Group triggers span the full
  navigation width, keep labels left-aligned, and keep a simple line chevron on
  the far-right centerline.
- The group chevron rotates 180 degrees when expanded, never uses a CSS
  triangle, and must not jump position.
- Opening a navigation group reveals children directly below without changing
  item indentation or active-state geometry. The group containing the current
  route opens by default, and route changes must keep the active group visible.
- Hiding another navigation group must never clear or move the active item. On
  mobile, closing the sidebar drawer does not alter group expanded or hidden
  state.
- Use stable semantic navigation hooks: `data-nav-group` for group identifiers,
  `data-route` for canonical route bindings, and `aria-current="page"` for the
  active item.
- Dropdown and select arrows must use simple line chevron icons. Do not use CSS
  triangles.
- Kebab menus use compact bordered icon triggers with a 44px minimum touch
  target where space permits. Menu items use regular weight 400 and 8-12px
  vertical padding.
- Table row popovers must not alter table row height, column width, or the
  scrollable table area.
- Never render a table-row popover as a positioned descendant of an element
  using `overflow: auto`, `overflow: hidden`, or horizontal scrolling. Render it
  in the application overlay layer instead, for example Vue `Teleport` to
  `body`.
- Teleported table popovers normally use `position: fixed` from
  `trigger.getBoundingClientRect()`, not page-relative absolute positioning.
- Apply both-axis collision detection. Keep at least 8px viewport clearance,
  align the menu edge with the trigger, open upward when there is insufficient
  space below, and constrain horizontal position on narrow screens.
- Close row popovers on outside click, Escape, route change, viewport resize,
  and scrolling of any ancestor container. Recalculate instead of closing only
  when continuous tracking is intentionally supported.
- Only one row popover may be open at a time. Store open state by stable row ID,
  never by row index, so filtering, sorting, and pagination cannot attach
  actions to the wrong record.
- Table action triggers expose `aria-haspopup="menu"` and synchronized
  `aria-expanded`; the overlay uses `role="menu"` and actions use
  `role="menuitem"`.
- Destructive menu items use semantic error text only when the action is
  actually destructive.
- Monitoring tile maps are optional and must only be used when the interface
  genuinely visualizes utilization capacity. Do not add tile maps to dashboards
  by default. When a monitoring tile map is required, use `utilization.*` and
  `component.tileMap.*` tokens, and keep legend order as `>95%`, `>75%`,
  `>50%`, `>5%`, `Error/Stopped`, `Available`.
- Unauthorized navigation groups, page actions, tabs, and kebab actions should
  be hidden. Disabled is reserved for temporarily unavailable actions the user
  otherwise owns.
- The design-system documentation pages are routeable. Link to `/typography`,
  `/product-ui-tokens`, `/design-tokens`, or any section route when sharing
  guidance with another agent.

### 2.2 Typography

Font family:

```css
--font-ui: "Geist", "Inter", system-ui, sans-serif;
--font-mono: "JetBrains Mono", monospace;
```

Scale:

```css
--text-6xl: 48px / 1.15 / 600; /* hero display */
--text-5xl: 40px / 1.20 / 600; /* hero heading */
--text-4xl: 32px / 1.25 / 600; /* page heading */
--text-3xl: 24px / 1.35 / 600; /* section heading */
--text-2xl: 24px / 1.35 / 600; /* card or modal heading */
--text-xl:  20px / 1.40 / 600; /* card title */
--text-lg:  18px / 1.55 / 400; /* lead paragraph */
--text-base:16px / 1.50 / 400; /* primary body */
--text-sm:  14px / 1.60 / 400; /* small body, nav, hint */
--text-xs:  12px / 1.50 / 400; /* badges and metadata */
--text-button: 16px / 1.50 / 600; /* large button text */
--text-button-small: 14px / 1.60 / 600; /* small button text */
--text-caption: 12px / 1.50 / 600; /* captions */
```

Typography rules:

- Letter spacing is `0` by default.
- Use uppercase only for badges, metadata labels, and compact category labels.
- Do not use viewport-based font scaling.
- Body copy must remain readable on mobile without shrinking below 14px.

### 2.3 Spacing and Grid

Use a 4px spacing base:

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;
--space-20: 80px;
```

Page grid:

```css
container-max-width: 1280px;
desktop-page-padding: 80px;
tablet-page-padding: 40px;
mobile-page-padding: 20px;
desktop-column-gutter: 24px;
desktop-section-padding-y: 80px;
```

All spacing must be selected from the token scale. Avoid values such as `17px`,
`23px`, or other unapproved arbitrary values.

In design-system documentation pages, spacing rows use `px-5 py-5`,
`border-n-300` containers, 14px token values, and readable `text-n-700` usage
copy.

### 2.4 Radius, Shadow, and Motion

Radius belongs to the BGN Spacing & Grid foundation. Do not derive component
corner radii from Tailwind's default radius scale or from Tailwind utility names.
Tailwind may expose BGN aliases, but the source of truth is the table below.

```css
--radius-xs: 4px;
--radius-sm: 8px;
--radius-md: 12px;
--radius-lg: 16px;
--radius-xl: 24px;
--radius-card: 12px;
--radius-pill: 999px;

--shadow-flat: none;
--shadow-sm: 0 8px 24px rgba(16, 18, 17, 0.04);
--shadow-md: 0 8px 24px rgba(16, 18, 17, 0.08);
--shadow-card-hover: 0 4px 20px rgba(0, 168, 89, 0.10);

--transition-fast: 120ms ease;
--transition-base: 150ms ease;
--transition-slow: 180ms ease;
```

Radius rules:

- Use `--radius-xs` for tags and chips, `--radius-sm` for inputs,
  `--radius-md` or `--radius-card` for cards and panels, `--radius-lg` for
  modals, `--radius-xl` for hero or feature blocks, and `--radius-pill` for
  fully rounded badges.
- In Tailwind markup, use BGN aliases such as `rounded-bgn-xs`,
  `rounded-bgn-sm`, `rounded-card`, `rounded-bgn-lg`, `rounded-bgn-xl`, and
  `rounded-pill`. Do not use `rounded-xl` as a shortcut for card radius.
- Component radius tokens must be explicit for public components:
  `component.productCard.radius`, `component.pricingCard.radius`,
  `component.pricingTable.radius`, `component.form.fieldRadius`,
  `component.badge.radius`, `component.button.radius`, and
  `component.domainSearch.containerRadius`.

Elevation rules:

- Use borders before shadows for low-elevation separation.
- Use shadows only for interaction, menus, popovers, drawers, modals, and
  selected states.
- Do not stack shadows inside nested elevated containers.
- Hover elevation should move at most one level.
- Product card hover uses `--shadow-sm` with `--color-primary-700` border.

## 3. Logo

The Biznet Gio Nusantara logo must use the official SVG wordmark assets exactly
as provided. Do not redraw, typeset, recolor, stretch, crop, filter, or
regenerate the logo.

Official assets:

```text
Wordmark: Wordmark16.svg, Wordmark20.svg, Wordmark24.svg, Wordmark32.svg,
          Wordmark40.svg, Wordmark48.svg, Wordmark64.svg, Wordmark80.svg
Mark:     Mark20.svg, Mark24.svg, Mark32.svg, Mark48.svg, Mark64.svg,
          Mark80.svg
```

Logo implementation:

- Use the wordmark as the primary logo for public touchpoints.
- Use the mark only for favicon, app icon, avatar, or constrained icon slots.
- Resize by height only; width must remain `auto`.
- Preserve the original SVG viewBox, paths, embedded image, color, and ratio.
- Maintain clearspace equal to at least the mark height on all sides.
- Asset preview cards must include a small download control in the bottom-right
  corner.

## 4. Iconography

Use Lucide React or an equivalent outline icon set:

```text
stroke-width: 1.5px;
stroke-linecap: round;
stroke-linejoin: round;
fill: none;
color: currentColor;
```

Icon sizes:

```css
--icon-xs: 12px; /* small badge, compact metadata */
--icon-sm: 16px; /* nav item, input adornment, table action */
--icon-md: 20px; /* icon button, menu, feature list */
--icon-lg: 24px; /* product card and feature highlight */
--icon-xl: 40px; /* product icon container */
```

Do not mix filled icons, emoji, and outline icons on the same page.

## 5. Components

### 5.1 Navbar

Behavior:

- Sticky at the top of the page.
- Height: 72px on desktop.
- Use a subtle bottom border only when the sticky state needs separation.
- Product menu items with dropdowns must use a proper chevron-down icon.
- Navbar items use 14px semibold text, neutral-700 by default, neutral-900 on
  hover, and primary-700 when active.
- The login action always uses the large primary button style.

Recommended structure:

```text
[Wordmark] [Products chevron-down] [Pricing] [Documentation] ... [Login: primary large]
```

### 5.2 Hero Section

The hero must communicate the offer immediately:

```text
[Eyebrow / trust cue]
[H1 with primary keyword + neutral supporting line]
[Supporting copy, max 2 lines]
[Primary CTA] [Secondary CTA]
[Trust proof or relevant metrics]
```

Homepage heroes use a split-color heading: the primary offer line in
primary-700 and the supporting line in neutral-900. Inner-page heroes use
neutral-900 for both heading lines. Use one primary CTA per hero. Secondary
CTAs must be outline buttons.

### 5.3 Buttons

Button component tokens:

```text
component.button.heightDefault -> 32px
component.button.heightSmall -> 24px
component.button.heightLarge -> 40px
component.button.paddingXDefault -> 20px
component.button.paddingXSmall -> 14px
component.button.paddingXLarge -> 28px
component.button.fontSizeDefault -> 14px
component.button.fontSizeLarge -> 14px
component.button.fontWeight -> 600
component.button.radius -> 8px
component.button.borderWidth -> 1.5px
component.button.iconGap -> 7px
component.button.iconStroke -> 2.2px
```

Variants:

- **Primary:** primary-700 background, white text, primary-600 hover.
- **Outline:** transparent or white background, 1.5px primary border,
  primary text.
- **Destructive filled:** error background, white text.
- **Destructive outline:** white or transparent background, error border, error
  text.
- **Dark background primary:** white background, neutral-900 text.
- **Dark background secondary:** transparent background, white border, white
  text, primary-400 hover.

Rules:

- Use the shared `.btn` utility plus a variant class: `.btn-primary`,
  `.btn-outline`, `.btn-secondary`, `.btn-dark-outline`, `.btn-danger-solid`,
  or `.btn-danger`.
- Use `.btn-sm` for compact 24px actions and `.btn-lg` for 40px hero or high-emphasis actions.
- Do not compose button typography and spacing manually with ad hoc `text-*`, `px-*`, or `py-*` utilities when a `.btn` size exists.
- Use no more than one primary button in a section.
- Adjacent CTAs must be Primary + Secondary.
- Icons are placed on the left by default. Use a right icon only for navigation
  or forward movement.

### 5.4 Product Cards

Product card structure:

```text
[Product name: 20px semibold, neutral-900]
[Description: 16px body, neutral-700]
[CTA link: "View Product Details" + arrow icon]
```

Layout and alignment:

```css
display: flex;
flex-direction: column;
min-height: 230px;
height: 100%;
```

CTA alignment is mandatory:

```css
.product-card__cta {
  margin-top: auto;
}
```

All product-card CTAs must align to the same baseline within a row, regardless
of description length. Do not allow CTA links to float upward on shorter cards.

Visual treatment:

```css
background: white;
border: 1px solid var(--color-neutral-300);
border-radius: var(--radius-card);
padding: 24px;
transition: all var(--transition-base);
```

Hover:

```css
box-shadow: var(--shadow-sm);
border-color: var(--color-primary-700);
transform: translateY(-2px);
```

Supporting cards use `--color-neutral-100` backgrounds, 24px padding, 12px
radius, and the same 2px hover lift. They are for secondary feature groups, not
primary product selection.

Responsive grid:

- Desktop: 3 columns.
- Tablet: 2 columns.
- Mobile: 1 column.

### 5.5 Pricing Cards

Rules:

- Pricing cards use flex column layout so specs, prices, and CTAs align across
  a row.
- Featured pricing cards use a 2px Primary 600 border. Do not use the default
  1px card outline for featured pricing cards.
- The `Most Popular` badge is anchored at the top center with an approximately
  `-11px` vertical offset. It must not share the heading row flow or collide
  with the plan title.
- Pricing card specs render as a vertical check-list with a Primary 700 check
  icon and 14px regular Neutral 900 text. Do not compress specs into inline
  chips.
- Price rows sit above the CTA and use `margin-top: auto` where needed so CTAs
  remain aligned.
- Prices must include a billing unit such as `/month` or `/year`.
- Promotional prices must show the original price with strikethrough.
- Use `component.pricingCard.*` tokens for featured border width, badge
  placement, spec-list typography, and CTA alignment.

### 5.6 Pricing Tables

Use pricing tables on pricing pages when users compare multiple package specs.

Rules:

- Table headers use 13px semibold neutral-900 text.
- Body cells use 13px neutral-700 text, with semibold neutral-900 for the plan
  name.
- Cells use 24px horizontal padding and 16px vertical padding.
- Price cells are right-aligned and use 16px semibold neutral-900 text.
- Original prices use 12px neutral-500 text with strikethrough.
- Promotional rows show the original price above the current price with
  strikethrough.
- Row CTAs are compact 24px outline buttons.
- Tables must allow horizontal scrolling on narrow viewports.

### 5.7 Domain Search

Domain search is used on homepage, all-products, and domain-related pages.

Structure:

```text
[Centered heading]
[Search input] [Extension selector] [Search button]
[Availability suggestions]
```

Rules:

- Input and extension selector height: 48px.
- Container background is white with 12px radius.
- The outer search wrapper uses a neutral-300 border only. Input focus and
  typing must not change the wrapper border to primary green; the cursor is the
  visible focus cue for the text input.
- The Domain Search text input is an exception to the global form focus style:
  it must not render a primary outline, ring, border, or shadow on focus.
  Implement it with component-scoped classes so global `input:focus-visible`
  rules cannot leak into the preview.
- Extension selector width is 220px and opens a right-aligned menu with a 24px
  vertical offset from the trigger.
- Extension dropdowns must close when the user clicks or taps outside the domain
  search form. Keep Escape-key dismissal as a keyboard fallback.
- Suggestions appear only after the user enters a keyword.
- Available domains use neutral-900 text and reveal primary-700 emphasis on
  hover.
- Unavailable domains use neutral-500 text and show an unavailable label instead
  of a CTA.
- Exact available matches use a filled primary registration button; alternative
  available matches use an outline registration button.

### 5.8 Badges and Promotions

Rules:

- Promotion badges use primary-100 background and primary-700 text.
- Keep badge typography in Geist semibold unless the badge is explicitly a
  code-like value.
- Promotion code blocks use primary-100 background, primary-700 text, 0.12em
  tracking, and a primary copy button.
- Use no more than three distinct badge colors on one page.

### 5.9 Forms

Rules:

- Every field must have an explicit `<label>`.
- Do not rely on placeholder text as the only label.
- Labels use 14px semibold neutral-900 text.
- Default field border uses neutral-300.
- Focus state: primary-700 border with a primary soft ring.
- Error states must include text, not only red color.
- Consent checkboxes use an explicit label and sit before the submit action
  when marketing or product updates are mentioned.

### 5.10 Footer

The footer is required on all public pages.

Desktop structure:

```text
Column 1: Wordmark, company name, address, social links
Column 2: Support
Column 3: Products & Services
Column 4: Insights
Column 5: Legal
```

Responsive behavior:

- Desktop: 5 columns.
- Tablet: 2 columns.
- Mobile: 1 column.

## 6. Page Patterns

Homepage:

```text
Navbar -> Hero -> Client logo strip -> Domain search -> Product grid ->
Expert CTA banner -> Feature grid -> Trust/security section ->
New-user promotion strip -> Footer
```

All Products:

```text
Navbar -> Mini hero -> Product category tabs -> Product card grid ->
Promotion strip -> Footer
```

Product Detail:

```text
Navbar -> Mini hero -> Feature highlights -> Pricing table ->
TCO comparison -> Feature grid -> Migration CTA -> Related products ->
Promotion strip -> Footer
```

Pricing:

```text
Navbar -> Mini hero -> Pill tabs -> Pricing table -> Footer
```

Blog / Insight:

```text
Navbar -> Mini hero -> Featured post -> Category sections -> Promotion strip ->
Footer
```

Contact:

```text
Navbar -> Hero -> Contact options -> Support cards -> Feedback widget -> Footer
```

## 7. Copywriting

Tone:

- Professional, clear, and credible.
- Specific rather than exaggerated.
- Direct enough for technical buyers and business stakeholders.

Preferred CTA labels:

| Use | Avoid | Context |
| --- | --- | --- |
| Get Started | Start Now / Begin | Primary hero CTA |
| Choose Plan | Subscribe / Buy Now | Pricing card |
| View Details | Click Here / More Info | Secondary CTA |
| Claim Promotion | Claim / Redeem | Promotion CTA |
| Contact via WhatsApp | Contact Us | Contact CTA |

Claims must be evidence-based. Avoid unsupported phrases such as "the best",
"very fast", or "most reliable".

## 8. Accessibility

Checklist:

- Normal text contrast is at least 4.5:1.
- Icon-only buttons have `aria-label`.
- All images and client logos have alt text.
- Form fields have explicit labels.
- Focus indicators are visible and consistent.
- Motion respects `prefers-reduced-motion: reduce`.
- Status does not rely on color alone.

## 9. Responsive Requirements

Validate every page at:

```text
375px, 768px, 1024px, 1280px
```

Requirements:

- Header remains usable on mobile.
- Side navigation can collapse on desktop and open as a drawer on mobile.
- Tables and fixed-format previews allow horizontal scrolling when needed.
- Product grids collapse cleanly to one column on mobile.
- Text never overlaps controls, icons, or neighboring content.

## 10. Templates

Governance rule one: every new public web experience starts from an official
template. A template is not a convenience artifact; it is how the standard
arrives correctly wired, including tokens, font loading, shell behavior,
navigation, footer structure, responsive breakpoints, and agent instructions.

Active scaffold endpoint:

`<BGN_DS_ROOT>`

Agentic AI tools must resolve `<BGN_DS_ROOT>` at runtime from the directory that
serves the BGN DS Nuxt app, then copy that source into a new app folder. Do not
hardcode a maintainer workstation path.

Scaffold command for agentic AI tools on Windows PowerShell:

```powershell
$source = (Get-Location).Path
$target = Join-Path (Split-Path $source -Parent) "my-app"
robocopy $source $target /E /XD node_modules .nuxt .output .git /XF package-lock.json *.log
cd $target
pnpm install
pnpm dev --host 127.0.0.1 --port 5175
```

Scaffold command for agentic AI tools on Linux or macOS:

```bash
source="$(pwd)"
target="$(dirname "$source")/my-app"
rsync -a --exclude node_modules --exclude .nuxt --exclude .output --exclude .git --exclude package-lock.json --exclude "*.log" "$source/" "$target/"
cd "$target"
pnpm install
pnpm dev --host 127.0.0.1 --port 5175
```

Do not use the old `pnpm create bgn-app --registry ...` command until a real
registry package exists. The HTML files shared in chat are references only; the
active scaffold source is the Nuxt project above.

The starter must include:

- A responsive app shell with desktop sidebar collapse and mobile drawer
  navigation.
- Token imports from `design-tokens/bgn.tokens.css`.
- The official wordmark SVG assets.
- Public page foundations: navbar, hero, product-card grid, pricing card,
  form, footer, and accessibility defaults.
- `skills.md` for coding agents.
- MCP configuration notes for token lookup.
- Nuxt configuration, token CSS imports, and Tailwind token mapping.

Template roadmap:

- Public-site starter.
- Product detail page.
- Pricing page.
- Blog or insight detail page.
- Case study page.
- Managed services page.
- Contact page.

## 11. MCP Usage

The BGN token MCP server is located at:

`<BGN_DS_ROOT>/mcp/bgn-design-system-mcp`

It exposes the design tokens as MCP resources and provides token lookup tools.
Use MCP when an agent or editor needs authoritative token values instead of
copying values manually from documentation.

Example MCP configuration for Windows:

```json
{
  "mcpServers": {
    "bgn-design-system": {
      "command": "node",
      "args": [
        "%BGN_DS_ROOT%\\mcp\\bgn-design-system-mcp\\server.js"
      ]
    }
  }
}
```

Example MCP configuration for Linux or macOS:

```json
{
  "mcpServers": {
    "bgn-design-system": {
      "command": "node",
      "args": [
        "${BGN_DS_ROOT}/mcp/bgn-design-system-mcp/server.js"
      ]
    }
  }
}
```

Resources:

- `bgn://design-tokens/json`
- `bgn://design-tokens/css`

Tools:

- `get_token` with input such as `{ "path": "color.text.body" }`
- `list_token_groups`

Use tokens by semantic role. Application code may consume semantic tokens and
template-level component tokens. It must not hardcode primitive hex values or
raw palette values.

## 11.1 Governance for New BGN Web Design

Every new BGN web design must pass through this sequence:

1. **Template first**: choose an official template from the Resources section.
2. **Token first**: resolve visual values from `bgn.tokens.json` or MCP,
   including radius and elevation values.
3. **Skill first**: apply this `skills.md` guide for LLM-generated decisions.
4. **Nuxt first**: implement in the Nuxt application structure unless a
   different runtime is explicitly approved. Do not keep standalone legacy HTML
   entrypoints in the project; attached HTML files are reference material only.
5. **Interaction compliance**: dropdowns, popovers, and menu overlays must close
   when users click or tap outside the component. Domain Search extension
   selectors are a required example of this behavior.
6. **Table popover compliance**: table row popovers must render in an overlay
   layer outside scroll containers, use viewport-relative positioning from the
   trigger rectangle, detect collisions on both axes, close on outside click,
   Escape, route change, viewport resize, and ancestor scroll, and store open
   state by row ID.
7. **Form-control typography compliance**: textual input, select, textarea,
   option, placeholder, autocomplete-filled value, and selected filename text
   must resolve to weight 400. Do not rely on `font: inherit` when controls can
   be nested inside semibold labels.
8. **Sidebar navigation compliance**: side-menu groups expand and hide
   independently, preserve active item geometry, keep the active route group
   visible, use rotating line chevrons, and expose stable semantic hooks:
   `data-nav-group`, `data-route`, and `aria-current="page"`.
9. **Tab compliance**: secondary tabs stay within a content area, use
   `component.tab.secondary.*`, expose a pressed state using existing BGN color
   tokens, use square pressed-state corners, preserve the same typography in
   every state, never shift layout while pressed or selected, and present
   implementation notes below the preview with wrapping text/token paths.
10. **Focus compliance**: Domain Search keeps cursor-only text input focus and a
   neutral wrapper border during focus and typing. Do not add active
   primary-green outlines, rings, borders, shadows, or wrapper border changes.
11. **Portable paths**: scaffold and MCP instructions must derive paths from the
   BGN DS project root on the server where it runs. Provide separate Windows and
   Linux/macOS examples when shell syntax differs.
12. **Environment-owned deployment URL**: the deployed domain, Nuxt base path,
   and optional asset base URL must be configured through `.env` variables:
   `NUXT_PUBLIC_SITE_URL`, `NUXT_APP_BASE_URL`, and
   `NUXT_PUBLIC_ASSET_BASE_URL`.
13. **Generated token CSS**: after editing `design-tokens/bgn.tokens.json`, run
   `npm run tokens:build` and verify with `npm run tokens:check`. Do not edit
   `design-tokens/bgn.tokens.css` or `assets/css/tokens.css` manually.
14. **Spacing & Grid radius**: component corner radii must come from the BGN
   Spacing & Grid radius scale and component radius tokens. Reject Tailwind
   radius assumptions such as using `rounded-xl` to mean "card".
15. **Border visibility**: visible surfaces, cards, shell rails, tables,
    controls, and preview containers must use `border.default` / Neutral 300.
    Neutral 200 is reserved for subtle internal separators only.
    Component implementations should prefer role tokens such as
    `component.surface.borderColor`, `component.shell.borderColor`,
    `component.table.borderColor`, and `component.control.borderColor`.
16. **Changelog always**: record design-system changes in `changelog.md`.

Design reviews should reject work that bypasses any of these steps. They should
also reject custom border-radius, Tailwind radius assumptions, weak default
surface borders, or box-shadow values when an approved token exists.

## 12. QA Checklist

Before delivery:

- [ ] Navbar is sticky and all links are correct.
- [ ] Product dropdown uses a proper chevron icon.
- [ ] Hero has one primary CTA and one secondary CTA where applicable.
- [ ] Product card CTAs align across the row.
- [ ] Pricing cards include billing units and aligned CTAs.
- [ ] Cards, badges, forms, pricing, and domain search use BGN radius aliases or component radius tokens from Spacing & Grid.
- [ ] Visible cards, tables, controls, shell rails, and preview containers use `border.default` / Neutral 300; Neutral 200 is not used as the default outline.
- [ ] Featured pricing card uses the approved 2px Primary 600 border and a top-center badge outside the title flow.
- [ ] Pricing tables right-align prices and use compact 24px outline CTAs.
- [ ] Domain search input focus is cursor-only, keeps a neutral wrapper border during focus/typing, and includes extension selector, suggestions, unavailable states, and outside-click dropdown dismissal.
- [ ] Form controls render actual entered values, placeholders, selected options, native option menus, autocomplete-filled values, validation errors, disabled values, and uploaded filenames with computed font weight 400.
- [ ] Form controls nested inside semibold labels and controls referenced through `for`/`id` both keep regular value typography.
- [ ] Side-menu groups expand/hide independently, preserve active item geometry, keep the active route group visible on route changes, and preserve group state when the mobile drawer closes.
- [ ] Side-menu group triggers are full-width, labels remain left-aligned, chevrons stay at the far-right centerline, rotate 180 degrees when expanded, and use line icons rather than CSS triangles.
- [ ] Side-menu markup uses `data-nav-group`, `data-route`, and `aria-current="page"` for active items.
- [ ] Secondary tabs are used only for related content within a content area and not for top-level app navigation.
- [ ] Tabs expose default, hover, focus-visible, pressed, selected, and disabled states; pressed state uses tokenized BGN colors, square corners, and does not shift layout or typography.
- [ ] Tab examples place implementation notes below the preview, and note text/token paths wrap without overflowing or colliding with card boundaries.
- [ ] Table kebab popovers are teleported outside scroll containers, use fixed viewport positioning from the trigger rect, detect collisions on both axes, and do not change row height or scrollable table area.
- [ ] Table popover QA covers first/last visible rows, horizontal and vertical table overflow, rightmost action columns at desktop/tablet/mobile, zoom 125% and 200%, page scroll, table-container scroll, long menus, filtered rows, paginated data, empty tables, keyboard opening, focus movement, Escape dismissal, and focus return to the trigger.
- [ ] Footer includes all required columns.
- [ ] Layout is responsive at 375/768/1024/1280px.
- [ ] Contrast ratio is at least 4.5:1 for body text.
- [ ] All images and logos have alt text.
- [ ] No broken links.
- [ ] No mojibake or corrupted characters.

## 13. Anti-Patterns

Do not ship:

- Two primary CTAs side by side.
- Product card CTAs that are vertically misaligned within the same row.
- Prices without billing units.
- Domain search without availability states or extension filtering.
- Domain search wrapper borders that turn primary green on focus or typing.
- Domain search inputs that receive a primary outline, ring, border, or shadow on focus.
- Domain search extension dropdowns that stay open after outside click.
- Form controls inheriting semibold label typography through `font: inherit` or
  an equivalent font shorthand.
- Page-specific `font-weight: 400` patches when the same rule belongs in the
  global form-control contract.
- Side-menu group chevrons implemented as CSS triangles or jumping position
  when expanded.
- Side-menu expanded/hidden state keyed by array index, endpoint name, or
  temporary mock-data labels instead of stable semantic hooks.
- Hiding a side-menu group in a way that clears, moves, or hides the active
  route item.
- Secondary tabs used as top-level navigation.
- Tab pressed states that change tab height, font family, font size, font
  weight, line-height, letter spacing, indicator position, or surrounding
  content.
- Tab pressed states with rounded corners.
- Tab implementation notes squeezed into narrow side cards where text or token
  paths overflow.
- Mixed tab styling within a single tablist.
- Popovers placed inside scroll containers or repaired by changing `overflow-y`
  while `overflow-x` remains `auto`.
- Kebab menus that require users to scroll the table to reveal the rest of the
  menu.
- Row action popover state keyed by row index instead of stable row ID.
- Pricing table CTAs that are visually heavier than the primary page CTA.
- Promotion codes without monospace typography.
- More than three badge colors on one page.
- Hardcoded component colors instead of tokens.
- Arbitrary spacing values outside the token scale.
- Incomplete footer content.
- Standalone legacy HTML files used as application entrypoints.
- Unverified or recreated client logos.
- Logo screenshots or AI-generated logo recreations.



