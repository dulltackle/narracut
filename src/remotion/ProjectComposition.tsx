import "@fontsource-variable/noto-sans-sc";

import { Audio, Video } from "@remotion/media";
import { useEffect, useState, type CSSProperties } from "react";
import {
  AbsoluteFill,
  cancelRender,
  continueRender,
  delayRender,
  Easing,
  Img,
  interpolate,
  Sequence,
  useCurrentFrame,
} from "remotion";

import { motionDurationInFrames, type TextBlockContent } from "../shared/project";
import {
  projectMediaUrl,
  type RenderSnapshot,
  type ResolvedScene,
} from "./render-snapshot";

const FONT_FAMILY = '"Noto Sans SC Variable", sans-serif';

function useNarracutFont() {
  const [handle] = useState(() => delayRender("等待 Narracut 内置字体"));
  useEffect(() => {
    let active = true;
    void Promise.all([
      document.fonts.load(`400 1em ${FONT_FAMILY}`),
      document.fonts.load(`700 1em ${FONT_FAMILY}`),
      document.fonts.load(`900 1em ${FONT_FAMILY}`),
    ])
      .then((loadedFonts) => {
        if (loadedFonts.some((fonts) => fonts.length === 0)) {
          throw new Error("Narracut 内置字体未能加载。");
        }
        if (active) continueRender(handle);
      })
      .catch((error: unknown) => {
        if (!active) return;
        cancelRender(
          error instanceof Error
            ? error
            : new Error("Narracut 内置字体未能加载。"),
        );
      });
    return () => {
      active = false;
    };
  }, [handle]);
}

function AssetLayer({ snapshot, resolved }: { snapshot: RenderSnapshot; resolved: ResolvedScene }) {
  const visual = resolved.scene.visual;
  if (visual.type === "card") {
    return (
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 78% 18%, rgba(0,163,166,.2), transparent 34%), #0f172a",
        }}
      />
    );
  }
  const asset =
    visual.assetId === undefined
      ? undefined
      : snapshot.project.assets.find((candidate) => candidate.id === visual.assetId);
  if (asset === undefined) {
    return (
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#111827",
          color: "#94a3b8",
          fontSize: 38,
        }}
      >
        尚未绑定 {visual.type === "image" ? "Image" : "Video"} Asset
      </AbsoluteFill>
    );
  }
  const src = projectMediaUrl(snapshot, asset.path);
  if (snapshot.mediaAvailability[asset.path] === false) {
    return (
      <AbsoluteFill
        style={{ alignItems: "center", justifyContent: "center", backgroundColor: "#111827", color: "#94a3b8", fontSize: 38 }}
      >
        项目中的 Asset 文件不可用
      </AbsoluteFill>
    );
  }
  return visual.type === "image" ? (
    <Img src={src} style={{ width: "100%", height: "100%", objectFit: "contain", background: "#0f172a" }} />
  ) : (
    <Video src={src} muted objectFit="contain" style={{ width: "100%", height: "100%", background: "#0f172a" }} />
  );
}

function textContent(resolved: ResolvedScene): TextBlockContent | undefined {
  const visual = resolved.scene.visual;
  if (visual.type === "card") return visual;
  return visual.caption === undefined ? undefined : { body: visual.caption.text };
}

function TextBlock({ snapshot, resolved }: { snapshot: RenderSnapshot; resolved: ResolvedScene }) {
  const frame = useCurrentFrame();
  const content = textContent(resolved);
  const presentation = resolved.textPresentation;
  if (
    content === undefined ||
    presentation === undefined ||
    presentation.style === undefined ||
    presentation.motion === undefined
  ) {
    return null;
  }
  const { layout } = presentation.style;
  const duration = motionDurationInFrames(
    presentation.motion,
    snapshot.fps,
    resolved.durationInFrames,
  );
  const progress =
    duration === 0
      ? 1
      : interpolate(frame, [0, duration], [0, 1], {
          easing: Easing.bezier(...presentation.motion.easing),
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
  const opacity = interpolate(progress, [0, 1], [presentation.motion.from.opacity, 1]);
  const x = interpolate(progress, [0, 1], [presentation.motion.from.x, 0]);
  const y = interpolate(progress, [0, 1], [presentation.motion.from.y, 0]);
  const scale = presentation.scale;
  const blockStyle: CSSProperties = {
    position: "absolute",
    left: layout.left,
    top: layout.top,
    width: layout.width,
    maxHeight: layout.maxHeight,
    boxSizing: "border-box",
    overflow: "hidden",
    padding: layout.padding,
    borderRadius: layout.radius,
    background: layout.background,
    color: "#ffffff",
    textAlign: layout.align,
    opacity,
    transform: `translate3d(${x}px, ${y}px, 0)`,
  };
  return (
    <div
      style={blockStyle}
      data-testid="composition-text-block"
      data-text-style={presentation.styleId}
      data-text-motion={presentation.motionId}
    >
      {content.label ? (
        <div style={{ color: snapshot.project.theme.accentColor, fontSize: layout.labelSize * scale, fontWeight: 700, lineHeight: 1.25, marginBottom: 20 * scale }}>
          {content.label}
        </div>
      ) : null}
      {content.title ? (
        <div style={{ fontSize: layout.titleSize * scale, fontWeight: 900, lineHeight: 1.14, marginBottom: content.body || content.items ? 24 * scale : 0 }}>
          {content.title}
        </div>
      ) : null}
      {content.body ? (
        <div style={{ fontSize: layout.bodySize * scale, fontWeight: 400, lineHeight: 1.42, color: "#e2e8f0" }}>
          {content.body}
        </div>
      ) : null}
      {content.items ? (
        <ul style={{ display: "grid", gap: 14 * scale, margin: content.body ? `${24 * scale}px 0 0` : 0, paddingLeft: 42 * scale, fontSize: layout.itemSize * scale, lineHeight: 1.34, color: "#e2e8f0" }}>
          {content.items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

function Logo({ snapshot }: { snapshot: RenderSnapshot }) {
  const logoId = snapshot.project.theme.logoAssetId;
  const logo = snapshot.project.assets.find((asset) => asset.id === logoId);
  if (logo === undefined) return null;
  return (
    <Img
      src={projectMediaUrl(snapshot, logo.path)}
      style={{
        position: "absolute",
        top: snapshot.safeInset,
        right: snapshot.safeInset,
        width: 180,
        height: 88,
        objectFit: "contain",
      }}
    />
  );
}

function SceneComposition({ snapshot, resolved }: { snapshot: RenderSnapshot; resolved: ResolvedScene }) {
  const speech = resolved.scene.speech;
  return (
    <AbsoluteFill style={{ overflow: "hidden", fontFamily: FONT_FAMILY }} data-scene-id={resolved.scene.id} data-testid="player-visual">
      <AssetLayer snapshot={snapshot} resolved={resolved} />
      {speech === undefined ? null : <Audio src={projectMediaUrl(snapshot, speech.path)} />}
      <TextBlock snapshot={snapshot} resolved={resolved} />
      <Logo snapshot={snapshot} />
      <div
        data-testid="player-subtitle"
        style={{
          position: "absolute",
          left: snapshot.safeInset,
          right: snapshot.safeInset,
          bottom: 72,
          color: "#fff",
          fontSize: 52,
          fontWeight: 900,
          lineHeight: 1.28,
          textAlign: "center",
          WebkitTextStroke: "3px rgba(20, 14, 17, 0.94)",
          paintOrder: "stroke fill",
          textShadow:
            "0 0 6px rgba(20,14,17,1), 0 4px 14px rgba(20,14,17,1), 0 0 40px rgba(20,14,17,.85)",
        }}
      >
        {resolved.scene.narration.text || "请输入 Narration"}
      </div>
    </AbsoluteFill>
  );
}

export function ProjectComposition({ snapshot }: { snapshot: RenderSnapshot }) {
  useNarracutFont();
  return (
    <AbsoluteFill style={{ backgroundColor: "#0f172a" }}>
      {snapshot.scenes.map((resolved) => (
        <Sequence
          key={resolved.scene.id}
          name={`Scene ${resolved.scene.id}`}
          from={resolved.startFrame}
          durationInFrames={resolved.durationInFrames}
        >
          <SceneComposition snapshot={snapshot} resolved={resolved} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
