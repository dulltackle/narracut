import type { Asset, Caption, Visual } from "../shared/project";

export type VisualType = Visual["type"];
export type CaptionKind = Caption["kind"];

export type VisualMigration = {
  visual: Visual;
  losses: string[];
};

export function isCaptionVisual(
  visual: Visual,
): visual is Extract<Visual, { type: "image-caption" | "video-caption" }> {
  return visual.type === "image-caption" || visual.type === "video-caption";
}

export function isCaptionVisualType(
  type: VisualType,
): type is "image-caption" | "video-caption" {
  return type === "image-caption" || type === "video-caption";
}

function mediaKindForType(type: VisualType): Asset["kind"] | undefined {
  if (type === "image" || type === "image-caption") return "image";
  if (type === "video" || type === "video-caption") return "video";
  return undefined;
}

export function emptyCaption(kind: CaptionKind): Caption {
  return kind === "step"
    ? { kind: "step", number: "", name: "" }
    : { kind: "alert", text: "" };
}

export function captionLosses(caption: Caption): string[] {
  if (caption.kind === "step") {
    return [
      ...(caption.number === "" ? [] : [`步骤编号 ${caption.number}`]),
      ...(caption.name === "" ? [] : [`步骤名“${caption.name}”`]),
    ];
  }
  return caption.text === "" ? [] : [`警示文字“${caption.text}”`];
}

function visualFieldLosses(visual: Visual): string[] {
  if (visual.type === "title") {
    return [
      ...(visual.device === "" ? [] : [`设备名与型号“${visual.device}”`]),
      ...(visual.headline === "" ? [] : [`操作主题“${visual.headline}”`]),
      ...(visual.subheadline === undefined || visual.subheadline === ""
        ? []
        : [`副标题“${visual.subheadline}”`]),
    ];
  }
  if (visual.type === "end-card") {
    return [
      ...(visual.title === "" ? [] : [`片尾标题“${visual.title}”`]),
      ...visual.bullets.flatMap((bullet) =>
        bullet === "" ? [] : [`片尾要点“${bullet}”`],
      ),
    ];
  }
  return [];
}

function currentAssetId(visual: Visual): string | undefined {
  return "assetId" in visual ? visual.assetId : undefined;
}

export function migrateVisual(
  current: Visual,
  targetType: VisualType,
  asset: Asset | undefined,
  captionKind?: CaptionKind,
): VisualMigration {
  const currentMediaKind = mediaKindForType(current.type);
  const targetMediaKind = mediaKindForType(targetType);
  const assetId =
    currentMediaKind !== undefined && currentMediaKind === targetMediaKind
      ? currentAssetId(current)
      : undefined;
  const caption = isCaptionVisual(current)
    ? current.caption
    : captionKind === undefined
      ? undefined
      : emptyCaption(captionKind);

  let visual: Visual;
  switch (targetType) {
    case "title":
      visual = { type: "title", device: "", headline: "" };
      break;
    case "image":
      visual = assetId === undefined ? { type: "image" } : { type: "image", assetId };
      break;
    case "image-caption":
      if (caption === undefined) throw new Error("Caption Visual 必须先选择 Caption kind。");
      visual =
        assetId === undefined
          ? { type: "image-caption", caption }
          : { type: "image-caption", assetId, caption };
      break;
    case "video":
      visual = assetId === undefined ? { type: "video" } : { type: "video", assetId };
      break;
    case "video-caption":
      if (caption === undefined) throw new Error("Caption Visual 必须先选择 Caption kind。");
      visual =
        assetId === undefined
          ? { type: "video-caption", caption }
          : { type: "video-caption", assetId, caption };
      break;
    case "end-card":
      visual = { type: "end-card", title: "", bullets: [] };
      break;
  }

  const losses = [
    ...(currentAssetId(current) !== undefined && assetId === undefined
      ? [`Asset 文件“${asset?.path.split("/").at(-1) ?? currentAssetId(current)}”`]
      : []),
    ...(isCaptionVisual(current) && !isCaptionVisualType(targetType)
      ? captionLosses(current.caption)
      : []),
    ...visualFieldLosses(current),
  ];

  return { visual, losses };
}
