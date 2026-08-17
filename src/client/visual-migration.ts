import type { Asset, Caption, Visual } from "../shared/project";

export type VisualType = Visual["type"];
export type CardVisual = Extract<Visual, { type: "card" }>;

export type VisualMigration = {
  visual: Visual;
  losses: string[];
};

export function hasCaption(
  visual: Visual,
): visual is Extract<Visual, { type: "image" | "video" }> & {
  caption: Caption;
} {
  return visual.type !== "card" && visual.caption !== undefined;
}

export function captionLosses(caption: Caption): string[] {
  return [`Caption 正文“${caption.text}”`];
}

export function cardFieldLosses(card: CardVisual): string[] {
  return [
    ...(card.label === undefined ? [] : [`标签“${card.label}”`]),
    ...(card.title === undefined ? [] : [`标题“${card.title}”`]),
    ...(card.body === undefined ? [] : [`正文“${card.body}”`]),
    ...(card.items ?? []).map((item) => `列表项“${item}”`),
  ];
}

function assetLoss(
  visual: Visual,
  asset: Asset | undefined,
): string[] {
  if (visual.type === "card" || visual.assetId === undefined) return [];
  return [
    `当前 Scene 的 Asset 绑定“${asset?.path.split("/").at(-1) ?? visual.assetId}”（项目中的文件不会删除）`,
  ];
}

export function migrateVisual(
  current: Visual,
  targetType: VisualType,
  asset: Asset | undefined,
  cardDraft?: CardVisual,
): VisualMigration {
  if (current.type === targetType) {
    return { visual: current, losses: [] };
  }

  if (targetType === "card") {
    if (current.type === "card") return { visual: current, losses: [] };
    const visual =
      current.caption === undefined
        ? cardDraft
        : ({ type: "card", body: current.caption.text } as const);
    if (visual === undefined) {
      throw new Error("切换到 Card 前必须填写至少一项内容。");
    }
    return { visual, losses: assetLoss(current, asset) };
  }

  if (current.type === "card") {
    return {
      visual: { type: targetType },
      losses: cardFieldLosses(current),
    };
  }

  const sameAssetKind = current.type === targetType;
  const assetId = sameAssetKind ? current.assetId : undefined;
  const visual: Visual = {
    type: targetType,
    ...(assetId === undefined ? {} : { assetId }),
    ...(current.caption === undefined ? {} : { caption: current.caption }),
  };

  return {
    visual,
    losses: sameAssetKind ? [] : assetLoss(current, asset),
  };
}
