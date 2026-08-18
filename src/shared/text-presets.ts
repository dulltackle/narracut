export const DEFAULT_PROJECT_THEME = Object.freeze({
  presetId: "narracut/default@1",
  defaultTextStyleId: "narracut/panel@1",
  defaultTextMotionId: "narracut/fade@1",
  accentColor: "#00A3A6",
  fontId: "narracut/noto-sans-cjk-sc@1",
});

export type ProjectTheme = {
  presetId: string;
  defaultTextStyleId: string;
  defaultTextMotionId: string;
  accentColor: string;
  fontId: string;
  logoAssetId?: string;
};

export type TextOverrides = {
  textStyleId?: string;
  textMotionId?: string;
};

export type TextStylePreset = {
  id: string;
  name: string;
  description: string;
  layout: {
    left: number;
    top: number;
    width: number;
    maxHeight: number;
    padding: number;
    radius: number;
    align: "left" | "center";
    background: string;
    labelSize: number;
    titleSize: number;
    bodySize: number;
    itemSize: number;
  };
};

export type TextMotionPreset = {
  id: string;
  name: string;
  description: string;
  durationMs: number;
  easing: readonly [number, number, number, number];
  from: { opacity: number; x: number; y: number };
};

export const TEXT_STYLE_PRESETS: readonly TextStylePreset[] = Object.freeze([
  {
    id: "narracut/panel@1",
    name: "均衡面板",
    description: "在画面左上建立稳定、清晰的文字层级。",
    layout: {
      left: 80,
      top: 80,
      width: 960,
      maxHeight: 680,
      padding: 64,
      radius: 28,
      align: "left",
      background: "rgba(15, 23, 42, 0.9)",
      labelSize: 34,
      titleSize: 76,
      bodySize: 44,
      itemSize: 40,
    },
  },
  {
    id: "narracut/lower-third@1",
    name: "下部标题",
    description: "靠近画面下部，但为 Subtitle 保留独立安全空间。",
    layout: {
      left: 80,
      top: 560,
      width: 1160,
      maxHeight: 260,
      padding: 48,
      radius: 16,
      align: "left",
      background: "rgba(15, 23, 42, 0.92)",
      labelSize: 34,
      titleSize: 64,
      bodySize: 40,
      itemSize: 36,
    },
  },
  {
    id: "narracut/spotlight@1",
    name: "聚焦",
    description: "以居中、开阔的结构强调主要文字。",
    layout: {
      left: 180,
      top: 160,
      width: 1560,
      maxHeight: 620,
      padding: 72,
      radius: 28,
      align: "center",
      background: "rgba(15, 23, 42, 0.72)",
      labelSize: 40,
      titleSize: 104,
      bodySize: 48,
      itemSize: 42,
    },
  },
]);

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export const TEXT_MOTION_PRESETS: readonly TextMotionPreset[] = Object.freeze([
  {
    id: "narracut/fade@1",
    name: "淡入",
    description: "从透明平稳进入。",
    durationMs: 320,
    easing: EASE_OUT,
    from: { opacity: 0, x: 0, y: 0 },
  },
  {
    id: "narracut/none@1",
    name: "无进场",
    description: "从 Scene 第一帧完整显示。",
    durationMs: 0,
    easing: EASE_OUT,
    from: { opacity: 1, x: 0, y: 0 },
  },
  {
    id: "narracut/rise@1",
    name: "向上进入",
    description: "淡入并向上移动 16px。",
    durationMs: 320,
    easing: EASE_OUT,
    from: { opacity: 0, x: 0, y: 16 },
  },
  {
    id: "narracut/slide@1",
    name: "横向进入",
    description: "淡入并从左侧移动 48px。",
    durationMs: 320,
    easing: EASE_OUT,
    from: { opacity: 0, x: -48, y: 0 },
  },
]);

export const FONT_PRESETS = Object.freeze([
  {
    id: "narracut/noto-sans-cjk-sc@1",
    name: "Noto Sans CJK SC",
    family: "Narracut Noto Sans CJK SC",
    weights: [400, 700, 900] as const,
  },
]);

const stylesById = new Map(TEXT_STYLE_PRESETS.map((preset) => [preset.id, preset]));
const motionsById = new Map(TEXT_MOTION_PRESETS.map((preset) => [preset.id, preset]));
const supportedFontCodePointRanges = Object.values(fontUnicodeRanges).flatMap((value) =>
  value.split(",").map((range) => {
    const [start, end = start] = range.slice(2).split("-");
    return [Number.parseInt(start, 16), Number.parseInt(end, 16)] as const;
  }),
);

export function findUnsupportedFontCodePoints(
  text: string,
): Array<{ character: string; codePoint: number }> {
  const seen = new Set<number>();
  return Array.from(text).flatMap((character) => {
    const codePoint = character.codePointAt(0)!;
    if (
      seen.has(codePoint) ||
      supportedFontCodePointRanges.some(
        ([start, end]) => codePoint >= start && codePoint <= end,
      )
    ) {
      return [];
    }
    seen.add(codePoint);
    return [{ character, codePoint }];
  });
}

export function resolveTextPresentation(
  theme: ProjectTheme,
  overrides: TextOverrides,
) {
  const styleId = overrides.textStyleId ?? theme.defaultTextStyleId;
  const motionId = overrides.textMotionId ?? theme.defaultTextMotionId;
  return {
    style: stylesById.get(styleId),
    motion: motionsById.get(motionId),
    styleId,
    motionId,
    inheritedStyle: overrides.textStyleId === undefined,
    inheritedMotion: overrides.textMotionId === undefined,
  };
}

export function motionDurationInFrames(
  motion: TextMotionPreset,
  fps: number,
  sceneDurationInFrames: number,
): number {
  if (motion.durationMs === 0) return 0;
  const presetFrames = Math.max(1, Math.round((motion.durationMs / 1000) * fps));
  const shortSceneLimit = Math.max(1, Math.floor(sceneDurationInFrames * 0.25));
  return Math.min(presetFrames, shortSceneLimit);
}

export type TextBlockContent = {
  label?: string;
  title?: string;
  body?: string;
  items?: string[];
};

export function getTextStylePreset(id: string): TextStylePreset | undefined {
  return stylesById.get(id);
}

function visualUnits(value: string): number {
  return Array.from(value).reduce(
    (total, character) => total + (character.codePointAt(0)! <= 0x7f ? 0.55 : 1),
    0,
  );
}

function requiredTextHeight(
  preset: TextStylePreset,
  content: TextBlockContent,
  scale: number,
): number {
  const width = preset.layout.width - preset.layout.padding * 2;
  const fields = [
    content.label === undefined ? undefined : [content.label, preset.layout.labelSize],
    content.title === undefined ? undefined : [content.title, preset.layout.titleSize],
    content.body === undefined ? undefined : [content.body, preset.layout.bodySize],
    ...(content.items ?? []).map((item) => [item, preset.layout.itemSize] as const),
  ].filter((field): field is readonly [string, number] => field !== undefined);
  return fields.reduce((height, [value, fontSize], index) => {
    const charactersPerLine = Math.max(1, width / (fontSize * scale));
    const lines = Math.max(1, Math.ceil(visualUnits(value) / charactersPerLine));
    const gap = index === 0 ? 0 : 20 * scale;
    return height + gap + lines * fontSize * 1.28 * scale;
  }, 0);
}

export function evaluateTextLayout(
  preset: TextStylePreset,
  content: TextBlockContent,
): { scale: number; overflow: boolean } {
  const availableHeight = preset.layout.maxHeight - preset.layout.padding * 2;
  const naturalHeight = requiredTextHeight(preset, content, 1);
  if (naturalHeight <= availableHeight) return { scale: 1, overflow: false };
  const minimumScale = 0.7;
  if (requiredTextHeight(preset, content, minimumScale) > availableHeight) {
    return { scale: minimumScale, overflow: true };
  }
  return {
    scale: Math.max(minimumScale, availableHeight / naturalHeight),
    overflow: false,
  };
}

function relativeLuminance(color: string): number {
  const channels = [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

export function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}
import fontUnicodeRanges from "@fontsource-variable/noto-sans-sc/unicode.json";
