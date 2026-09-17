// Paleta de etiquetas no espírito do design system do monday.com (Vibe).

export interface PaletteColor {
  key: string;
  hex: string;
  name: string;
}

export const PALETTE: PaletteColor[] = [
  { key: 'done-green', hex: '#00c875', name: 'Verde' },
  { key: 'grass-green', hex: '#037f4c', name: 'Verde grama' },
  { key: 'bright-green', hex: '#9cd326', name: 'Verde-limão' },
  { key: 'saladish', hex: '#cab641', name: 'Oliva' },
  { key: 'egg-yolk', hex: '#ffcb00', name: 'Amarelo' },
  { key: 'working-orange', hex: '#fdab3d', name: 'Laranja' },
  { key: 'dark-orange', hex: '#ff6d3b', name: 'Laranja escuro' },
  { key: 'peach', hex: '#ffadad', name: 'Pêssego' },
  { key: 'sunset', hex: '#ff7575', name: 'Pôr do sol' },
  { key: 'stuck-red', hex: '#df2f4a', name: 'Vermelho' },
  { key: 'dark-red', hex: '#bb3354', name: 'Vermelho escuro' },
  { key: 'sofia-pink', hex: '#ff007f', name: 'Pink' },
  { key: 'lipstick', hex: '#ff5ac4', name: 'Batom' },
  { key: 'bubble', hex: '#faa1f1', name: 'Chiclete' },
  { key: 'purple', hex: '#9d50dd', name: 'Roxo' },
  { key: 'dark-purple', hex: '#784bd1', name: 'Roxo escuro' },
  { key: 'berry', hex: '#7e3b8a', name: 'Amora' },
  { key: 'dark-indigo', hex: '#401694', name: 'Índigo escuro' },
  { key: 'indigo', hex: '#5559df', name: 'Índigo' },
  { key: 'navy', hex: '#225091', name: 'Marinho' },
  { key: 'bright-blue', hex: '#579bfc', name: 'Azul' },
  { key: 'dark-blue', hex: '#0086c0', name: 'Azul escuro' },
  { key: 'royal', hex: '#2b76e5', name: 'Azul real' },
  { key: 'aquamarine', hex: '#4eccc6', name: 'Água-marinha' },
  { key: 'chili-blue', hex: '#66ccff', name: 'Azul-céu' },
  { key: 'river', hex: '#74afcc', name: 'Rio' },
  { key: 'teal', hex: '#175a63', name: 'Petróleo' },
  { key: 'winter', hex: '#9aadbd', name: 'Inverno' },
  { key: 'steel', hex: '#a9bee8', name: 'Aço' },
  { key: 'sky', hex: '#a1e3f6', name: 'Céu' },
  { key: 'lavender', hex: '#bda8f9', name: 'Lavanda' },
  { key: 'lilac', hex: '#9d99b9', name: 'Lilás' },
  { key: 'orchid', hex: '#e484bd', name: 'Orquídea' },
  { key: 'coffee', hex: '#cd9282', name: 'Café' },
  { key: 'tan', hex: '#bca58a', name: 'Bege' },
  { key: 'brown', hex: '#7f5347', name: 'Marrom' },
  { key: 'pecan', hex: '#563e3e', name: 'Pecã' },
  { key: 'explosive', hex: '#c4c4c4', name: 'Cinza' },
  { key: 'american-gray', hex: '#757575', name: 'Cinza escuro' },
  { key: 'blackish', hex: '#333333', name: 'Preto' },
];

/** Cor da célula de status vazia. */
export const EMPTY_STATUS_COLOR = '#c4c4c4';

/** Rodízio de cores para novos grupos. */
export const GROUP_COLORS = [
  '#579bfc',
  '#9d50dd',
  '#00c875',
  '#fdab3d',
  '#ff007f',
  '#0086c0',
  '#037f4c',
  '#784bd1',
  '#df2f4a',
  '#66ccff',
  '#ffcb00',
  '#175a63',
];

/** Rodízio de cores para avatares. */
export const AVATAR_COLORS = [
  '#579bfc',
  '#fdab3d',
  '#00c875',
  '#9d50dd',
  '#ff007f',
  '#0086c0',
  '#037f4c',
  '#784bd1',
  '#df2f4a',
  '#175a63',
  '#ff6d3b',
  '#5559df',
];

/** Rodízio de cores para novas etiquetas de status. */
export const LABEL_COLORS = [
  '#fdab3d',
  '#00c875',
  '#df2f4a',
  '#579bfc',
  '#9d50dd',
  '#ff007f',
  '#0086c0',
  '#037f4c',
  '#784bd1',
  '#ffcb00',
  '#175a63',
  '#ff6d3b',
  '#333333',
  '#66ccff',
  '#bb3354',
];

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim();

const ALIASES: Record<string, string> = {
  green: '#00c875',
  verde: '#00c875',
  'dark green': '#037f4c',
  'verde escuro': '#037f4c',
  lime: '#9cd326',
  'verde limao': '#9cd326',
  yellow: '#ffcb00',
  amarelo: '#ffcb00',
  orange: '#fdab3d',
  laranja: '#fdab3d',
  red: '#df2f4a',
  vermelho: '#df2f4a',
  'dark red': '#bb3354',
  pink: '#ff007f',
  rosa: '#ff5ac4',
  magenta: '#ff007f',
  purple: '#9d50dd',
  roxo: '#9d50dd',
  violet: '#784bd1',
  violeta: '#784bd1',
  indigo: '#5559df',
  navy: '#225091',
  marinho: '#225091',
  blue: '#579bfc',
  azul: '#579bfc',
  'dark blue': '#0086c0',
  'azul escuro': '#0086c0',
  'light blue': '#66ccff',
  'azul claro': '#66ccff',
  cyan: '#4eccc6',
  ciano: '#4eccc6',
  aqua: '#4eccc6',
  teal: '#175a63',
  petroleo: '#175a63',
  gray: '#c4c4c4',
  grey: '#c4c4c4',
  cinza: '#c4c4c4',
  black: '#333333',
  preto: '#333333',
  brown: '#7f5347',
  marrom: '#7f5347',
};

/** Aceita hex (#abc / #aabbcc), chave da paleta ou nome em PT/EN. Retorna null se não reconhecer. */
export function resolveColor(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    const [, r, g, b] = raw.toLowerCase();
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  const key = fold(raw);
  const byKey = PALETTE.find((c) => fold(c.key) === key || fold(c.name) === key);
  if (byKey) return byKey.hex;
  return ALIASES[key] ?? null;
}

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** Texto branco em cores médias/escuras, texto escuro em cores muito claras. */
export function textColorOn(hex: string): string {
  return luminance(hex) > 0.62 ? '#323338' : '#ffffff';
}

/** Mistura a cor com branco (0 = cor pura, 1 = branco). */
export function tint(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const mix = (v: number) => Math.round(v + (255 - v) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
