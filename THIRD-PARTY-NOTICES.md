# Third-Party Notices

## Visual Assets & Character Licensing

### Hatsune Miku / Piapro Character License (PCL)
- The Hatsune Miku character is owned by **Crypton Future Media, Inc.** and licensed under the **Piapro Character License (PCL)** (`https://piapro.jp/license/pcl`).
- Private Rules is a personal, non-commercial, self-hosted project. Any Miku-themed artwork (banner, login backdrop, empty-state illustrations, about emblem) is used strictly for non-commercial purposes under PCL terms and must not be redistributed for commercial gain.
- During 1.1.0 development, placeholder WebP graphics in `src/web/assets/` are derived from `assets/banner.webp` (in the same Miku teal/magenta visual style) and will be finalized prior to the 1.1.0 release.

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
