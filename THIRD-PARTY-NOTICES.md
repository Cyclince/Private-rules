# Third-Party Notices

## Visual Assets & Character Licensing

### Hatsune Miku / Piapro Character License (PCL)
- The Hatsune Miku character is owned by **Crypton Future Media, Inc.** and licensed under the **Piapro Character License (PCL)** (`https://piapro.jp/license/pcl`).
- Private Rules is a personal, non-commercial, self-hosted project. Any Miku-themed artwork (banner, login backdrop, empty-state illustrations, about emblem) is used strictly for non-commercial purposes under PCL terms and must not be redistributed for commercial gain.
- The four finalized WebP assets in `src/web/assets/` (`miku-login-bg.webp`, `miku-about-emblem.webp`, `miku-empty-state.webp`, `miku-dashboard-banner.webp`) and the matching PWA icons in `public/` (`pwa-icon-192.png`, `pwa-icon-512.png`, `apple-touch-icon.png`, `apple-touch-icon-1.1.0.png`) are AI-generated Hatsune Miku fan artwork created on 2026-11-27 with Antigravity CLI's Gemini image generation tool (`generate_image`), using `assets/banner.webp` as the style reference, and are used for personal, non-commercial purposes under the Piapro Character License.

## Open-Source Software Licenses

Private Rules incorporates open-source packages under permissive licenses (MIT / Apache-2.0 / ISC / BSD):

| Package | Purpose | License |
| --- | --- | --- |
| React & React DOM | UI runtime | MIT |
| Vite & `@cloudflare/vite-plugin` | Frontend & Worker bundler | MIT |
| Hono & `@hono/zod-validator` | HTTP router & RPC types | MIT |
| Tailwind CSS (`tailwindcss`, `@tailwindcss/vite`) | Design tokens & utility CSS | MIT |
| Radix UI Primitives (`@radix-ui/react-*`) | Accessible UI primitives (via shadcn/ui pattern) | MIT |
| `class-variance-authority`, `clsx`, `tailwind-merge` | Component variants & class merging | Apache-2.0 / MIT |
| `@tanstack/react-router`, `@tanstack/react-query` | Type-safe routing & server-state caching | MIT |
| `react-hook-form`, `@hookform/resolvers` | Form state & Zod validation | MIT |
| `motion` | Reduced-motion-aware UI transitions | MIT |
| `lucide-react` | Line icon set | ISC |
| Drizzle ORM (`drizzle-orm`, `drizzle-kit`) | Schema & query builder | Apache-2.0 |
| Zod | Runtime & static schema validation | MIT |
| `better-sqlite3` | Node.js SQLite driver | MIT |
| `uqr` | Local client-side QR code SVG generation | MIT |
| `opencc-js` | Build-time Simplified-to-Traditional Chinese dictionary generation (devDependency only in 1.1.0) | MIT |

## Built-in Data, Rule Catalog & Reference Projects

Private Rules **does not bundle or copy** third-party rule files, template files, or region regexes into this repository. The built-in rule catalog (`src/builtin/catalog.ts`) stores **remote URLs and metadata only**; built-in region definitions (`src/domain/nodes/regions.ts`), starter app cards (`src/builtin/cards.ts`), and starter templates (`src/builtin/templates.ts`) are authored independently for Private Rules.

### Rule Catalog Upstream Sources (URL & Metadata Index Only)

| Repository | Usage in Private Rules | License |
| --- | --- | --- |
| [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat) | Rule catalog index URLs for GeoSite / GeoIP lists | GPL-3.0 (upstream [v2fly/domain-list-community](https://github.com/v2fly/domain-list-community) MIT) |
| [blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script) | Rule catalog index URLs for application/service rule lists | See upstream repository license declaration |
| [ACL4SSR/ACL4SSR](https://github.com/ACL4SSR/ACL4SSR) | Rule catalog index URLs for LAN and ad-blocking rule lists | See upstream repository license declaration |
| [Aethersailor/Custom_OpenClash_Rules](https://github.com/Aethersailor/Custom_OpenClash_Rules) | Rule catalog index URLs only (custom direct/proxy supplement); **no rules, templates, or regexes are copied** | CC BY-SA 4.0 |
| [Koolson/Qure](https://github.com/Koolson/Qure) | Preset icon pack URL (`QureColor-All.json`) fetched at runtime when enabled | See upstream repository license declaration |

### Design & Architectural References

| Project | License | Attribution |
| --- | --- | --- |
| [pengchujin/tower](https://github.com/pengchujin/tower) | MIT | Architectural inspiration for categorized rule catalog, base + overlay separation, ruleset reference planning, condition trees, and strategy group icon recognition |
| [Aethersailor/Custom_OpenClash_Rules](https://github.com/Aethersailor/Custom_OpenClash_Rules) | CC BY-SA 4.0 | Conceptual inspiration for 7-layer rule stratification, 4-tier starter templates, slot-level info exclusion, and minimal/full output profiles (independently designed and implemented) |
| ISO 3166-1 / IATA codes | Public standards | Country codes, regional indicator flags, and airport codes in `src/domain/nodes/regions.ts` |

## AI-Generated Visual Asset Prompts (1.1.0)

The four finalized Miku WebP assets in `src/web/assets/` were generated on 2026-11-27 with Antigravity CLI's Gemini `generate_image` tool using `assets/banner.webp` as the style reference:

### `miku-login-bg.webp`
> High-resolution 16:9 modern anime illustration matching the exact character design, linework, and cel-shaded lighting style of Hatsune Miku in the reference image, but placed against a dark, atmospheric, uncluttered futuristic background (do not include any monitors, tablets, phones, UI screens, or text from the reference). Composition: Hatsune Miku is positioned strictly in the far right third of the frame from waist up, in a graceful three-quarter pose looking slightly toward the left with a gentle, confident smile. She wears her iconic sleeveless silver- grey collared blouse with a cyan tie, dark detached sleeves with cyan trim, sleek dark headphones, and magenta (#E12885) hair clips. Her long translucent cyan-teal twin-tails (#39C5BB) flow dynamically toward the right edge of the frame, with subtle glowing holographic rings and fine delicate cyan light trails curving softly around her. The entire left and center two- thirds of the frame are a very clean, calm, uncluttered deep dark teal gradient (#0B1418) with only sparse, soft glowing cyan (#39C5BB) light particles, subtle bokeh dots, and a few faint delicate curved cyan light lines fading smoothly into darkness, leaving spacious negative space on the left and center for a login overlay. Dark teal mood illuminated by crisp cyan glow and subtle magenta (#E12885) accents on her hair clips and headphone details. Strictly no text, no letters, no numbers, no logos, no UI elements, and no watermarks anywhere in the image.

### `miku-about-emblem.webp`
> A 1:1 square modern app-icon style emblem featuring a cute chibi Q-version Hatsune Miku head-and-shoulders avatar portrait matching the character colors and bright tech anime identity in the reference image, with simplified iconic shapes and a joyful playful wink and cheerful smile. She has bright #39C5BB cyan- teal hair with twin-tails framing her face neatly, #E12885 vivid magenta rectangular hair ties, sleek dark futuristic headphones with #E12885 magenta and cyan accents, and glossy bright cyan anime eyes. Rendered in a super-clean modern vector-inspired anime app icon style with bold, thick, crisp dark outlines and a clean bright white rim highlight separating her silhouette sharply from the background for maximum legibility at 36x36 pixels. Centered composition with generous, balanced padding on all four sides so her hair and head fit comfortably inside square, rounded-square, or circular masks. Background is a clean, simple smooth gradient from bright teal #39C5BB to rich mint-teal #1C8E8A with no busy scenery, no devices, no screens, and strictly NO text, NO letters, NO numbers, NO decals, and NO watermarks anywhere.

### `miku-empty-state.webp`
> Cute chibi Q-version Hatsune Miku illustration matching the crisp anime cel-shading style, linework, and exact character color palette of the reference image: bright cyan-teal (#39C5BB) long twin-tails and expressive teal eyes, hot magenta (#E12885) square hair ties and sleek dark headset with magenta accents, light silver-grey sleeveless collared top with a teal necktie, dark charcoal detached sleeves and pleated skirt with glowing cyan (#39C5BB) trim. She is standing centered in full body with a relaxed, cheerful, approachable smile and a gentle head tilt, holding a sleek dark-grey and cyan-rimmed futuristic clipboard in both hands. The paper clipped to the clipboard is completely blank pure white with zero text, zero letters, zero numbers, zero lines, and zero scribbles. Minimalist composition with generous empty whitespace around the character on a clean solid ultra-light cool mist (#F7FCFC) background, with only a few tiny subtle glowing cyan (#39C5BB) and magenta (#E12885) geometric sparkle accents floating gently nearby and a soft subtle ground shadow beneath her feet. Strictly no text, no letters, no numbers, no watermarks, and no UI panels anywhere in the image.

### `miku-dashboard-banner.webp`
> Full-bleed wide horizontal web dashboard header banner illustration, matching the crisp modern Japanese anime art style, character design, and futuristic tech aesthetic of the reference image, with NO text, NO letters, NO numbers, NO logos, NO watermarks, and NO laptops, tablets, phones, or UI screens anywhere. Strictly position Hatsune Miku on the far right 25- 30% of the frame in a waist-up pose, facing slightly left with a lively, bright, cheerful smiling expression, framed by glowing cyan light ribbons. Match her exact outfit and styling from the reference: long flowing #39C5BB teal-cyan twin-tails, bright cyan anime eyes, silver-white sleeveless collared top with a cyan tie, dark detached sleeves and pleated skirt with cyan trim, and headset and hair accessories with vivid #E12885 magenta accents. Keep the entire left 65-70% of the banner completely wide-open, clean, dark negative space for high- contrast light overlay title text: a sleek, smooth deep-teal gradient from #0B1418 to #123A40 with subtle luminous #39C5BB neon circuit light lines, faint holographic geometric patterns, and fine glowing cyan bokeh particles, transitioning gracefully rightward into a bright glowing #39C5BB cyan holographic aura illuminating Hatsune Miku on the right. Clean edge-to-edge composition with no borders or letterbox bars.
