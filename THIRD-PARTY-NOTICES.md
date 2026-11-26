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
