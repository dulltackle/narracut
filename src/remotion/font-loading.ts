import "@fontsource-variable/noto-sans-sc";

const FONT_WEIGHTS = [400, 700, 900] as const;

let fontLoadPromise: Promise<void> | undefined;

export function loadNarracutFont(fontFamily: string): Promise<void> {
  fontLoadPromise ??= Promise.all(
    FONT_WEIGHTS.map((weight) => document.fonts.load(`${weight} 1em ${fontFamily}`)),
  ).then((loadedFonts) => {
    if (loadedFonts.some((fonts) => fonts.length === 0)) {
      throw new Error("Narracut 内置字体未能加载。");
    }
  });
  return fontLoadPromise;
}
