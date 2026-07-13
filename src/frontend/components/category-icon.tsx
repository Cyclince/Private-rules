export function CategoryIcon({ icon, name, size = 44 }: { icon?: string; name: string; size?: number }) {
  const isUrl = Boolean(icon && /^https?:\/\//i.test(icon));
  return <span className="category-icon" style={{ width: size, height: size }}>{isUrl ? <img src={icon} alt="" loading="lazy" referrerPolicy="no-referrer" /> : (icon || name.slice(0, 2).toUpperCase())}</span>;
}
