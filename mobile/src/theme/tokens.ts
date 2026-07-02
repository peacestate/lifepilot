/**
 * Design tokens — single source of truth.
 * Verbatim from design/overwhelm/screen-spec.md §3. No hardcoded hex/spacing
 * anywhere else; everything references these.
 *
 * Theme: light / calm (the v1 primary). Dark theme (§3a) deferred to v1.1.
 */

export const color = {
  background: '#F7F8F6', // screen bg (soft off-white, faint warm green)
  surface: '#FFFFFF', // input, cards
  surfaceAlt: '#EEF1ED', // progress track, chip bg, pressed tint
  border: '#E1E5DF', // hairlines, input border
  textPrimary: '#2C322E', // headings, step text (softer than black)
  textSecondary: '#5C645E', // subtext, captions
  textTertiary: '#9AA29B', // disabled, checked/struck text, number badge
  accent: '#6B9080', // sage — CTA, checkbox, progress, links
  accentPressed: '#5A7C6E', // CTA pressed
  accentMuted: '#C7D6CF', // disabled CTA bg
  onAccent: '#FFFFFF', // text/glyph on accent
  error: '#A86B6B', // muted clay — error glyph (never bright red)
} as const;

/** 4pt spacing scale (§3c). */
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 32,
  8: 48,
} as const;

/** Corner radii (§3d). */
export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/**
 * Typography (§3b). System font; respect OS Dynamic Type via allowFontScaling.
 * Roles map 1:1 to the spec table.
 */
export const type = {
  h1: { fontSize: 26, lineHeight: 34, fontWeight: '600' as const }, // prompt
  h2: { fontSize: 20, lineHeight: 28, fontWeight: '600' as const }, // task summary
  body: { fontSize: 17, lineHeight: 26, fontWeight: '400' as const }, // steps, input
  subtext: { fontSize: 15, lineHeight: 22, fontWeight: '400' as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  captionStrong: { fontSize: 13, lineHeight: 18, fontWeight: '600' as const }, // number badge
} as const;

/** Elevation (§3e) — kept nearly flat. Prefer borders over shadows. */
export const elevation = {
  e0: {},
  // e1: focused input / results card — subtle.
  e1: {
    shadowColor: '#2C322E',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 2, // Android
  },
} as const;

/** Max content width; center on tablets (§2). */
export const layout = {
  maxContentWidth: 480,
  screenPaddingH: space[5],
  minTouchTarget: 44,
} as const;

export const tokens = { color, space, radii, type, elevation, layout };
export default tokens;
