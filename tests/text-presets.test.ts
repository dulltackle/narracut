import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROJECT_THEME,
  motionDurationInFrames,
  resolveTextPresentation,
  TEXT_MOTION_PRESETS,
  TEXT_STYLE_PRESETS,
} from "../src/shared/text-presets";

describe("版本化文字 Preset", () => {
  it("分别解析 Card 与 Caption 的项目默认值和显式覆盖", () => {
    expect(resolveTextPresentation(DEFAULT_PROJECT_THEME, {})).toMatchObject({
      style: { id: "narracut/panel@1", name: "均衡面板" },
      motion: { id: "narracut/fade@1", name: "淡入" },
      inheritedStyle: true,
      inheritedMotion: true,
    });

    expect(
      resolveTextPresentation(DEFAULT_PROJECT_THEME, {
        textStyleId: "narracut/lower-third@1",
        textMotionId: "narracut/slide@1",
      }),
    ).toMatchObject({
      style: { id: "narracut/lower-third@1", name: "下部标题" },
      motion: { id: "narracut/slide@1", name: "横向进入" },
      inheritedStyle: false,
      inheritedMotion: false,
    });
  });

  it("按固定曲线缩短短 Scene 的进场，且 Text Block 不产生退场", () => {
    const fade = TEXT_MOTION_PRESETS.find(
      (preset) => preset.id === "narracut/fade@1",
    )!;
    const none = TEXT_MOTION_PRESETS.find(
      (preset) => preset.id === "narracut/none@1",
    )!;

    expect(motionDurationInFrames(fade, 30, 150)).toBe(10);
    expect(motionDurationInFrames(fade, 30, 8)).toBe(2);
    expect(motionDurationInFrames(none, 30, 8)).toBe(0);
  });

  it("冻结全部 @1 Preset 的像素与时间语义", () => {
    expect(TEXT_STYLE_PRESETS.map(({ id, layout }) => ({ id, layout }))).toEqual([
      {
        id: "narracut/panel@1",
        layout: { left: 80, top: 80, width: 960, maxHeight: 680, padding: 64, radius: 28, align: "left", background: "rgba(15, 23, 42, 0.9)", labelSize: 34, titleSize: 76, bodySize: 44, itemSize: 40 },
      },
      {
        id: "narracut/lower-third@1",
        layout: { left: 80, top: 560, width: 1160, maxHeight: 260, padding: 48, radius: 16, align: "left", background: "rgba(15, 23, 42, 0.92)", labelSize: 34, titleSize: 64, bodySize: 40, itemSize: 36 },
      },
      {
        id: "narracut/spotlight@1",
        layout: { left: 180, top: 160, width: 1560, maxHeight: 620, padding: 72, radius: 28, align: "center", background: "rgba(15, 23, 42, 0.72)", labelSize: 40, titleSize: 104, bodySize: 48, itemSize: 42 },
      },
    ]);
    expect(TEXT_MOTION_PRESETS.map(({ id, durationMs, easing, from }) => ({ id, durationMs, easing, from }))).toEqual([
      { id: "narracut/fade@1", durationMs: 320, easing: [0.22, 1, 0.36, 1], from: { opacity: 0, x: 0, y: 0 } },
      { id: "narracut/none@1", durationMs: 0, easing: [0.22, 1, 0.36, 1], from: { opacity: 1, x: 0, y: 0 } },
      { id: "narracut/rise@1", durationMs: 320, easing: [0.22, 1, 0.36, 1], from: { opacity: 0, x: 0, y: 16 } },
      { id: "narracut/slide@1", durationMs: 320, easing: [0.22, 1, 0.36, 1], from: { opacity: 0, x: -48, y: 0 } },
    ]);
    for (const { layout } of TEXT_STYLE_PRESETS) {
      expect(layout.left).toBeGreaterThanOrEqual(80);
      expect(layout.top).toBeGreaterThanOrEqual(80);
      expect(layout.left + layout.width).toBeLessThanOrEqual(1920 - 80);
      expect(layout.top + layout.maxHeight).toBeLessThanOrEqual(1080 - 80);
    }
  });
});
