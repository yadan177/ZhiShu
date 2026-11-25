import { useId, type ReactNode } from "react";

export function ZhiShuMark({ size = 32 }: { size?: number }) {
  const uid = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}_bg`} x1="28" y1="8" x2="228" y2="248" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="72%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#F6F9FD" />
        </linearGradient>
        <linearGradient id={`${uid}_g3`} x1="46" y1="118" x2="158" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#0284C7" />
        </linearGradient>
        <linearGradient id={`${uid}_g0`} x1="138" y1="48" x2="212" y2="160" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#1668E8" />
        </linearGradient>
        <linearGradient id={`${uid}_g1`} x1="202" y1="138" x2="94" y2="214" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1D4ED8" />
          <stop offset="100%" stopColor="#1E3A8A" />
        </linearGradient>
        <linearGradient id={`${uid}_g2`} x1="116" y1="204" x2="42" y2="96" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2563EB" />
          <stop offset="100%" stopColor="#4F46E5" />
        </linearGradient>
        <linearGradient id={`${uid}_spark`} x1="104" y1="104" x2="152" y2="152" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0EA5E9" />
          <stop offset="50%" stopColor="#1668E8" />
          <stop offset="100%" stopColor="#1E3A8A" />
        </linearGradient>
      </defs>
      <rect x="8" y="8" width="240" height="240" rx="56" fill={`url(#${uid}_bg)`} />
      <path
        d="M64 8H192C222.928 8 248 33.072 248 64V192C248 222.928 222.928 248 192 248H64C33.072 248 8 222.928 8 192V64C8 33.072 33.072 8 64 8ZM64 9.2C33.735 9.2 9.2 33.735 9.2 64V192C9.2 222.265 33.735 246.8 64 246.8H192C222.265 246.8 246.8 222.265 246.8 192V64C246.8 33.735 222.265 9.2 192 9.2H64Z"
        fillRule="evenodd"
        fill="#E2E8F0"
        fillOpacity="0.9"
      />
      <path d="M 139.74 87.84 L 169.06 58.51 Q 174.37 53.21 180.57 57.43 A 88.00 88.00 0 0 1 210.19 159.46 Q 207.21 166.34 201.91 161.04 L 139.74 98.87 Q 134.22 93.35 139.74 87.84 Z" fill={`url(#${uid}_g0)`} />
      <path d="M 168.16 139.74 L 197.49 169.06 Q 202.79 174.37 198.57 180.57 A 88.00 88.00 0 0 1 96.54 210.19 Q 89.66 207.21 94.96 201.91 L 157.13 139.74 Q 162.65 134.22 168.16 139.74 Z" fill={`url(#${uid}_g1)`} />
      <path d="M 116.26 168.16 L 86.94 197.49 Q 81.63 202.79 75.43 198.57 A 88.00 88.00 0 0 1 45.81 96.54 Q 48.79 89.66 54.09 94.96 L 116.26 157.13 Q 121.78 162.65 116.26 168.16 Z" fill={`url(#${uid}_g2)`} />
      <path d="M 87.84 116.26 L 58.51 86.94 Q 53.21 81.63 57.43 75.43 A 88.00 88.00 0 0 1 159.46 45.81 Q 166.34 48.79 161.04 54.09 L 98.87 116.26 Q 93.35 121.78 87.84 116.26 Z" fill={`url(#${uid}_g3)`} />
      <path d="M 128 99 Q 131.8 124.2 157 128 Q 131.8 131.8 128 157 Q 124.2 131.8 99 128 Q 124.2 124.2 128 99 Z" fill={`url(#${uid}_spark)`} />
    </svg>
  );
}

export type AssetGlyphKind =
  | "feishu"
  | "unity"
  | "pm"
  | "ui"
  | "3d"
  | "ta"
  | "fullstack"
  | "skill"
  | "local_plugin";

export function AssetGlyph({ kind, size = 24 }: { kind: AssetGlyphKind; size?: number }) {
  const uid = useId().replace(/:/g, "");
  switch (kind) {
    case "feishu":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id={`${uid}_ft`} x1="12" y1="6" x2="34" y2="25" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#00E2C3" />
              <stop offset="100%" stopColor="#00BFA8" />
            </linearGradient>
            <linearGradient id={`${uid}_fb`} x1="6" y1="18" x2="43" y2="39" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#4585FF" />
              <stop offset="55%" stopColor="#2B67FF" />
              <stop offset="100%" stopColor="#1450E8" />
            </linearGradient>
            <linearGradient id={`${uid}_fd`} x1="5" y1="16" x2="30" y2="36" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#1A44B8" />
              <stop offset="100%" stopColor="#12308A" />
            </linearGradient>
          </defs>
          <path d="M11.8 6.8H26.4C29.3 6.8 31.8 9.9 33.4 15.2L26.8 24.4C23.0 17.2 15.8 11.4 11.8 6.8Z" fill={`url(#${uid}_ft)`} />
          <path d="M4.2 16.4V34.6C7.6 37.8 13.4 41.2 19.6 41.2C24.8 41.2 29.8 39.6 34.0 35.6C39.2 30.6 39.2 23.0 43.8 18.2C40.4 16.4 35.6 14.8 28.6 22.8C25.4 26.4 21.4 28.8 17.0 28.8C12.2 28.8 7.6 22.0 4.2 16.4Z" fill={`url(#${uid}_fb)`} />
          <path d="M4.2 16.4C7.8 21.8 13.6 27.6 19.8 31.2C23.8 33.5 27.8 34.4 31.6 33.6C33.0 33.3 34.4 32.6 35.6 31.8C32.4 35.6 27.6 36.8 22.4 35.6C15.6 34.0 9.0 28.4 4.2 21.8V16.4Z" fill={`url(#${uid}_fd)`} />
        </svg>
      );
    case "unity":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id={`${uid}_un`} x1="10" y1="6" x2="38" y2="42" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#27272A" />
              <stop offset="100%" stopColor="#09090B" />
            </linearGradient>
          </defs>
          <g transform="translate(6.8, 5.2) scale(1.433)">
            <path fill={`url(#${uid}_un)`} d="m12.929 4.294l3.8 2.193c.136.077.141.29 0 .367l-4.515 2.608a.42.42 0 0 1-.425 0L7.274 6.854c-.139-.074-.141-.293 0-.367l3.797-2.193V0L1.376 5.598v11.195l3.718-2.146v-4.385c-.003-.157.18-.269.317-.184l4.515 2.607a.43.43 0 0 1 .214.368v5.213c.002.156-.181.268-.318.184l-3.8-2.193l-3.717 2.145L12 24l9.695-5.598l-3.717-2.145l-3.8 2.192c-.134.082-.323-.024-.318-.183v-5.213c0-.156.087-.296.214-.368l4.515-2.607c.134-.082.322.022.318.184v4.385l3.717 2.146V5.598L12.93 0Z" />
          </g>
        </svg>
      );
    case "pm":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id={`${uid}_pb`} x1="12" y1="6" x2="36" y2="38" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#34D399" />
              <stop offset="100%" stopColor="#059669" />
            </linearGradient>
            <linearGradient id={`${uid}_pf`} x1="8" y1="12" x2="34" y2="42" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#10B981" />
              <stop offset="100%" stopColor="#047857" />
            </linearGradient>
          </defs>
          <rect x="14" y="6" width="24" height="30" rx="5.5" fill={`url(#${uid}_pb)`} opacity="0.34" />
          <rect x="9" y="10" width="26" height="32" rx="6" fill={`url(#${uid}_pf)`} />
          <rect x="15" y="17" width="14" height="3.2" rx="1.6" fill="#FFFFFF" />
          <rect x="15" y="23.5" width="10" height="3" rx="1.5" fill="#A7F3D0" />
          <rect x="15" y="29.8" width="14" height="3" rx="1.5" fill="#A7F3D0" />
          <circle cx="35.5" cy="34.5" r="7.5" fill="#FFFFFF" />
          <circle cx="35.5" cy="34.5" r="5.6" fill="#0D9488" />
          <path d="M32.8 34.6L34.7 36.5L38.4 32.6" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "ui":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id={`${uid}_ur`} x1="8" y1="8" x2="28" y2="28" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#FB7185" />
              <stop offset="100%" stopColor="#E11D48" />
            </linearGradient>
            <linearGradient id={`${uid}_uv`} x1="20" y1="16" x2="40" y2="40" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#A78BFA" />
              <stop offset="100%" stopColor="#6D28D9" />
            </linearGradient>
            <linearGradient id={`${uid}_us`} x1="22" y1="8" x2="41" y2="24" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#38BDF8" />
              <stop offset="100%" stopColor="#2563EB" />
            </linearGradient>
          </defs>
          <rect x="7" y="8" width="18" height="18" rx="5.5" fill={`url(#${uid}_ur)`} />
          <circle cx="33.5" cy="16.5" r="7.5" fill={`url(#${uid}_us)`} />
          <rect x="7" y="29" width="14" height="11" rx="4" fill="#F43F5E" opacity="0.24" />
          <rect x="10" y="32" width="8" height="5" rx="2.2" fill="#E11D48" />
          <rect x="23" y="26" width="18" height="14" rx="5" fill={`url(#${uid}_uv)`} />
          <rect x="11.5" y="12.5" width="9" height="3.2" rx="1.6" fill="#FFFFFF" />
          <rect x="11.5" y="18" width="5.5" height="3.2" rx="1.6" fill="#FFE4E6" />
          <circle cx="33.5" cy="16.5" r="2.7" fill="#FFFFFF" />
          <rect x="27.5" y="31.5" width="9" height="3" rx="1.5" fill="#EDE9FE" />
        </svg>
      );
    case "3d":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id={`${uid}_dt`} x1="10" y1="7" x2="36" y2="23" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#7DD3FC" />
              <stop offset="100%" stopColor="#0EA5E9" />
            </linearGradient>
            <linearGradient id={`${uid}_dl`} x1="8" y1="16" x2="24" y2="42" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#0284C7" />
              <stop offset="100%" stopColor="#1E40AF" />
            </linearGradient>
            <linearGradient id={`${uid}_dr`} x1="24" y1="16" x2="40" y2="42" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#38BDF8" />
              <stop offset="100%" stopColor="#2563EB" />
            </linearGradient>
          </defs>
          <path d="M23.5 7.5L39.2 16.4L23.5 25.3L7.8 16.4L23.5 7.5Z" fill={`url(#${uid}_dt)`} />
          <path d="M7.8 16.4L23.5 25.3V42.4L7.8 33.5V16.4Z" fill={`url(#${uid}_dl)`} />
          <path d="M39.2 16.4L23.5 25.3V42.4L39.2 33.5V16.4Z" fill={`url(#${uid}_dr)`} />
          <path d="M23.5 25.3L39.2 16.4M23.5 25.3L7.8 16.4M23.5 25.3V42.4" stroke="#FFFFFF" strokeOpacity="0.6" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M38.5 5.5L39.8 9.2L43.5 10.5L39.8 11.8L38.5 15.5L37.2 11.8L33.5 10.5L37.2 9.2L38.5 5.5Z" fill="#0EA5E9" />
        </svg>
      );
    case "ta":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id={`${uid}_tm`} x1="10" y1="7" x2="36" y2="41" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#A855F7" />
              <stop offset="55%" stopColor="#6D28D9" />
              <stop offset="100%" stopColor="#4338CA" />
            </linearGradient>
            <linearGradient id={`${uid}_th`} x1="22" y1="6" x2="29" y2="25" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#E9D5FF" />
              <stop offset="100%" stopColor="#8B5CF6" />
            </linearGradient>
            <linearGradient id={`${uid}_ts`} x1="33" y1="8" x2="43" y2="18" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#22D3EE" />
              <stop offset="100%" stopColor="#3B82F6" />
            </linearGradient>
          </defs>
          <path d="M22.5 6.5C24.2 16.6 28.4 20.8 38.5 22.5C28.4 24.2 24.2 28.4 22.5 38.5C20.8 28.4 16.6 24.2 6.5 22.5C16.6 20.8 20.8 16.6 22.5 6.5Z" fill={`url(#${uid}_tm)`} />
          <path d="M22.5 6.5C24.2 16.6 28.4 20.8 38.5 22.5H22.5V6.5Z" fill={`url(#${uid}_th)`} opacity="0.65" />
          <path d="M37.5 7.2L39.0 11.2L43.0 12.7L39.0 14.2L37.5 18.2L36.0 14.2L32.0 12.7L36.0 11.2L37.5 7.2Z" fill={`url(#${uid}_ts)`} />
          <circle cx="36.5" cy="36.5" r="3.2" fill="#818CF8" />
        </svg>
      );
    case "fullstack":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id={`${uid}_fc`} x1="6" y1="11" x2="42" y2="37" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#2563EB" />
              <stop offset="100%" stopColor="#1D4ED8" />
            </linearGradient>
            <linearGradient id={`${uid}_fs`} x1="20" y1="8" x2="28" y2="40" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#38BDF8" />
              <stop offset="100%" stopColor="#0284C7" />
            </linearGradient>
          </defs>
          <path d="M18.6 13.8C19.6 14.7 19.6 16.3 18.6 17.3L11.9 24L18.6 30.7C19.6 31.7 19.6 33.3 18.6 34.2C17.7 35.2 16.1 35.2 15.1 34.2L6.7 25.8C5.7 24.8 5.7 23.2 6.7 22.2L15.1 13.8C16.1 12.8 17.7 12.8 18.6 13.8Z" fill={`url(#${uid}_fc)`} />
          <path d="M29.4 13.8C30.3 12.8 31.9 12.8 32.9 13.8L41.3 22.2C42.3 23.2 42.3 24.8 41.3 25.8L32.9 34.2C31.9 35.2 30.3 35.2 29.4 34.2C28.4 33.3 28.4 31.7 29.4 30.7L36.1 24L29.4 17.3C28.4 16.3 28.4 14.7 29.4 13.8Z" fill={`url(#${uid}_fc)`} />
          <path d="M26.7 9.6C28.0 10.0 28.7 11.4 28.3 12.7L22.3 36.7C21.9 38.0 20.5 38.7 19.2 38.3C17.9 37.9 17.2 36.5 17.6 35.2L23.6 11.2C24.0 9.9 25.4 9.2 26.7 9.6Z" fill={`url(#${uid}_fs)`} />
        </svg>
      );
    case "skill":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id={`${uid}_sg`} x1="12" y1="6" x2="36" y2="42" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#FBBF24" />
              <stop offset="55%" stopColor="#F59E0B" />
              <stop offset="100%" stopColor="#EA580C" />
            </linearGradient>
            <linearGradient id={`${uid}_sh`} x1="16" y1="6" x2="29" y2="24" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#FEF3C7" />
              <stop offset="100%" stopColor="#F59E0B" />
            </linearGradient>
          </defs>
          <path d="M27.4 6.2L11.6 25.4C10.9 26.3 11.5 27.6 12.7 27.6H22.2L19.4 40.8C19.1 42.1 20.7 43.0 21.6 41.9L36.8 22.8C37.5 21.9 36.9 20.6 35.7 20.6H26.4L29.6 7.3C29.9 6.0 28.3 5.1 27.4 6.2Z" fill={`url(#${uid}_sg)`} />
          <path d="M27.4 6.2L11.6 25.4C10.9 26.3 11.5 27.6 12.7 27.6H22.2L26.4 20.6L29.6 7.3C29.9 6.0 28.3 5.1 27.4 6.2Z" fill={`url(#${uid}_sh)`} opacity="0.48" />
        </svg>
      );
    case "local_plugin":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id={`${uid}_la`} x1="8" y1="8" x2="26" y2="26" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#818CF8" />
              <stop offset="100%" stopColor="#4F46E5" />
            </linearGradient>
            <linearGradient id={`${uid}_lb`} x1="22" y1="22" x2="40" y2="40" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#60A5FA" />
              <stop offset="100%" stopColor="#2563EB" />
            </linearGradient>
          </defs>
          <rect x="8" y="8" width="14.5" height="14.5" rx="4.5" fill={`url(#${uid}_la)`} />
          <rect x="25.5" y="8" width="14.5" height="14.5" rx="4.5" fill="#6366F1" opacity="0.28" />
          <rect x="8" y="25.5" width="14.5" height="14.5" rx="4.5" fill="#3B82F6" opacity="0.28" />
          <rect x="25.5" y="25.5" width="14.5" height="14.5" rx="4.5" fill={`url(#${uid}_lb)`} />
          <circle cx="32.75" cy="15.25" r="3.2" fill="#4F46E5" />
          <circle cx="15.25" cy="32.75" r="3.2" fill="#2563EB" />
        </svg>
      );
  }
}

export function glyphForAsset(name: string, kind: string): AssetGlyphKind {
  if (kind === "skill") return "skill";
  const tokens = new Set(name.toLocaleLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  if (tokens.has("fullstack")) return "fullstack";
  if (tokens.has("unity")) return "unity";
  if (tokens.has("pm") || tokens.has("product")) return "pm";
  if (tokens.has("ui")) return "ui";
  if (tokens.has("3d")) return "3d";
  if (tokens.has("ta") || tokens.has("vfx")) return "ta";
  return "local_plugin";
}

export function IconTile({ size = "md", children }: { size?: "sm" | "md" | "lg"; children: ReactNode }) {
  return <span className={`icon-tile icon-tile--${size}`}>{children}</span>;
}
