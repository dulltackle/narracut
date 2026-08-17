import { describe, expect, it } from "vitest";

import { migrateVisual } from "../src/client/visual-migration";
import type { Asset, Visual } from "../src/shared/project";

const imageAsset: Asset = {
  id: "10000000-0000-4000-8000-000000000001",
  kind: "image",
  path: "assets/device.png",
};

describe("V2 Visual 原子迁移", () => {
  it("Image 与 Video 互换时保留 Caption，但清除并列出不兼容 Asset", () => {
    const current: Visual = {
      type: "image",
      assetId: imageAsset.id,
      caption: { text: "准备连接管" },
    };

    expect(migrateVisual(current, "video", imageAsset)).toEqual({
      visual: { type: "video", caption: { text: "准备连接管" } },
      losses: ["当前 Scene 的 Asset 绑定“device.png”（项目中的文件不会删除）"],
    });
  });

  it("Image 或 Video 转 Card 时把 Caption 正文无损迁移为 Card 正文", () => {
    const current: Visual = {
      type: "image",
      assetId: imageAsset.id,
      caption: { text: "准备连接管" },
    };

    expect(migrateVisual(current, "card", imageAsset)).toEqual({
      visual: { type: "card", body: "准备连接管" },
      losses: ["当前 Scene 的 Asset 绑定“device.png”（项目中的文件不会删除）"],
    });
  });

  it("没有 Caption 的媒体转 Card 时必须先提供非空 Card 草稿", () => {
    const current: Visual = { type: "video" };

    expect(() => migrateVisual(current, "card", undefined)).toThrow(
      "切换到 Card 前必须填写至少一项内容。",
    );
    expect(
      migrateVisual(current, "card", undefined, {
        type: "card",
        title: "章节标题",
      }),
    ).toEqual({
      visual: { type: "card", title: "章节标题" },
      losses: [],
    });
  });

  it("Card 转媒体时逐项列出无法无损保存的结构化文字", () => {
    const current: Visual = {
      type: "card",
      label: "章节",
      title: "连接设备",
      body: "准备连接管",
      items: ["关闭阀门", "复核连接"],
    };

    expect(migrateVisual(current, "image", undefined)).toEqual({
      visual: { type: "image" },
      losses: [
        "标签“章节”",
        "标题“连接设备”",
        "正文“准备连接管”",
        "列表项“关闭阀门”",
        "列表项“复核连接”",
      ],
    });
  });
});
