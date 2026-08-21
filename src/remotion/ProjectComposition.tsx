import { Audio, Video } from "@remotion/media";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  AbsoluteFill,
  cancelRender,
  continueRender,
  delayRender,
  Easing,
  Freeze,
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
import { loadNarracutFont } from "./font-loading";

type FontLoadState = "blocked" | "loading" | "ready" | "error";

function useNarracutFont(fontFamily: string, mode: RenderSnapshot["mode"]): FontLoadState {
  const [state, setState] = useState<FontLoadState>("loading");
  const [handle] = useState(() => delayRender("等待 Narracut 内置字体"));
  useEffect(() => {
    let active = true;
    let settled = false;
    void loadNarracutFont(fontFamily)
      .then(() => {
        if (!active) return;
        settled = true;
        setState("ready");
        continueRender(handle);
      })
      .catch((error: unknown) => {
        if (!active) return;
        const renderError =
          error instanceof Error
            ? error
            : new Error("Narracut 内置字体未能加载。");
        settled = true;
        if (mode === "preview") {
          setState("error");
          continueRender(handle);
        } else {
          cancelRender(renderError);
        }
      });
    return () => {
      active = false;
      if (!settled) continueRender(handle);
    };
  }, [fontFamily, handle, mode]);
  return state;
}

function CompositionState({
  label,
  title,
  detail,
  tone = "neutral",
}: {
  label: string;
  title: string;
  detail: string;
  tone?: "neutral" | "danger";
}) {
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        padding: 120,
        backgroundColor: "#0f172a",
        color: "#ffffff",
        textAlign: "center",
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          padding: "52px 64px",
          border: `2px solid ${tone === "danger" ? "#fb7185" : "#334155"}`,
          borderRadius: 28,
          background: "rgba(15, 23, 42, 0.96)",
        }}
      >
        <div
          style={{
            color: tone === "danger" ? "#fda4af" : "#5eead4",
            fontSize: 28,
            fontWeight: 700,
            marginBottom: 18,
          }}
        >
          {label}
        </div>
        <div style={{ fontSize: 58, fontWeight: 900, lineHeight: 1.2 }}>{title}</div>
        <div
          style={{
            color: "#cbd5e1",
            fontSize: 32,
            lineHeight: 1.5,
            marginTop: 22,
          }}
        >
          {detail}
        </div>
      </div>
    </AbsoluteFill>
  );
}

function AssetPlaceholder({
  visualType,
  reason,
}: {
  visualType: "image" | "video";
  reason: string;
}) {
  const label = visualType === "image" ? "Image" : "Video";
  return (
    <AbsoluteFill
      data-testid="asset-placeholder"
      data-asset-kind={visualType}
      style={{
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#111827",
        color: "#e2e8f0",
      }}
    >
      <div style={{ maxWidth: 1200, textAlign: "center" }}>
        <div
          style={{
            display: "inline-block",
            padding: "10px 18px",
            border: "2px solid #475569",
            borderRadius: 12,
            color: "#94a3b8",
            fontSize: 38,
            fontWeight: 700,
          }}
        >
          {label} Asset 不可用
        </div>
        <div style={{ marginTop: 28, fontSize: 62, fontWeight: 700 }}>{reason}</div>
        <div style={{ marginTop: 20, color: "#94a3b8", fontSize: 38 }}>
          请在 Inspector 中重新绑定或恢复项目文件
        </div>
      </div>
    </AbsoluteFill>
  );
}

function MediaAsset({
  src,
  visualType,
  videoPlaybackWindow,
}: {
  src: string;
  visualType: "image" | "video";
  videoPlaybackWindow?: ResolvedScene["videoPlaybackWindow"];
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const rootRef = useRef<HTMLDivElement>(null);
  const currentFrame = useCurrentFrame();
  const markError = () => setStatus("error");
  if (status === "error") {
    return <AssetPlaceholder visualType={visualType} reason="当前文件无法读取或解码" />;
  }
  const video = (trimBefore?: number) => (
    <Video
      src={src}
      muted
      loop={false}
      trimBefore={trimBefore}
      disallowFallbackToOffthreadVideo
      onVideoFrame={() => {
        setStatus("ready");
        rootRef.current?.setAttribute("data-video-rendered-at-frame", String(currentFrame));
        rootRef.current?.setAttribute(
          "data-video-rendered-layer",
          trimBefore === undefined ? "live" : "freeze",
        );
      }}
      onError={() => {
        markError();
        return "fail";
      }}
      objectFit="contain"
      style={{ width: "100%", height: "100%", background: "#0f172a" }}
    />
  );
  return (
    <AbsoluteFill
      ref={rootRef}
      data-testid="media-asset"
      data-media-kind={visualType}
      data-media-muted={visualType === "video" ? "true" : undefined}
      data-media-status={status}
      data-video-source-frames={videoPlaybackWindow?.sourceDurationInFrames}
      data-video-freeze-frame={videoPlaybackWindow?.freezeFrame}
    >
      {visualType === "image" ? (
        <Img
          src={src}
          onLoad={() => setStatus("ready")}
          onError={markError}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            background: "#0f172a",
          }}
        />
      ) : (
        videoPlaybackWindow?.freezeFrame === undefined ? video() : (
          <>
            <Sequence durationInFrames={videoPlaybackWindow.durationInFrames}>
              {video()}
            </Sequence>
            <Sequence from={videoPlaybackWindow.durationInFrames}>
              <Freeze frame={0}>{video(videoPlaybackWindow.freezeFrame)}</Freeze>
            </Sequence>
          </>
        )
      )}
      {status === "loading" ? (
        <CompositionState
          label={`正在加载 ${visualType === "image" ? "IMAGE" : "VIDEO"}`}
          title="正在准备当前 Asset"
          detail="画面就绪前不会显示上一 Scene 或旧文件。"
        />
      ) : null}
    </AbsoluteFill>
  );
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
    return <AssetPlaceholder visualType={visual.type} reason="尚未绑定 Asset" />;
  }
  const src = projectMediaUrl(snapshot, asset.path);
  if (snapshot.mediaAvailability[asset.path] === false) {
    return <AssetPlaceholder visualType={visual.type} reason="项目中的文件不存在" />;
  }
  if (asset.kind !== visual.type) {
    return <AssetPlaceholder visualType={visual.type} reason="绑定的 Asset 类型不匹配" />;
  }
  return (
    <MediaAsset
      key={src}
      src={src}
      visualType={visual.type}
      videoPlaybackWindow={resolved.videoPlaybackWindow}
    />
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
  if (resolved.textBlockers.visual.length > 0) {
    const characters = resolved.textBlockers.visual
      .map((diagnostic) => `${diagnostic.character ?? "?"} · U+${diagnostic.codePoint?.toString(16).toUpperCase() ?? "?"}`)
      .join("，");
    return (
      <div
        data-testid="player-visual-text-error"
        style={{
          position: "absolute",
          left: layout.left,
          top: layout.top,
          width: layout.width,
          minHeight: 180,
          display: "grid",
          alignContent: "center",
          gap: 12,
          padding: 44,
          borderRadius: layout.radius,
          background: "rgba(76, 5, 25, 0.94)",
          color: "#fff1f4",
        }}
      >
        <strong style={{ fontSize: 42 }}>这层文字包含字体不支持的字符</strong>
        <span style={{ fontSize: 30, color: "#fda4af" }}>{characters}</span>
      </div>
    );
  }
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
    <AbsoluteFill style={{ overflow: "hidden", fontFamily: snapshot.fontFamily }} data-scene-id={resolved.scene.id} data-testid="player-visual">
      <AssetLayer snapshot={snapshot} resolved={resolved} />
      {speech === undefined || snapshot.mediaAvailability[speech.path] === false ? null : (
        <Audio src={projectMediaUrl(snapshot, speech.path)} />
      )}
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
        {resolved.textBlockers.narration.length > 0 ? (
          <span data-testid="player-subtitle-text-error" style={{ display: "inline-block", padding: "12px 20px", borderRadius: 12, background: "rgba(76, 5, 25, 0.94)", color: "#fda4af", fontSize: 34 }}>
            Subtitle 缺字 · {resolved.textBlockers.narration.map((diagnostic) => `U+${diagnostic.codePoint?.toString(16).toUpperCase() ?? "?"}`).join(" · ")}
          </span>
        ) : resolved.scene.narration.text || "请输入 Narration"}
      </div>
    </AbsoluteFill>
  );
}

function ReadyProjectComposition({ snapshot, fontFamily }: { snapshot: RenderSnapshot; fontFamily: string }) {
  const fontState = useNarracutFont(fontFamily, snapshot.mode);
  if (fontState === "loading") {
    return (
      <AbsoluteFill style={{ fontFamily: snapshot.fontFamily }} data-testid="composition-loading">
        <CompositionState
          label="正在加载 FONT"
          title="正在准备内置字体"
          detail="Player 与 renderer 共用同一份本地字体加载结果。"
        />
      </AbsoluteFill>
    );
  }
  if (fontState === "error") {
    return (
      <AbsoluteFill style={{ fontFamily: snapshot.fontFamily }} data-testid="composition-blocker">
        <CompositionState
          tone="danger"
          label="PREVIEW 已阻断"
          title="内置字体加载失败"
          detail="请重新打开项目；Narracut 不会改用系统字体或在线字体。"
        />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ backgroundColor: "#0f172a", fontFamily }}>
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

export function ProjectComposition({ snapshot }: { snapshot: RenderSnapshot }) {
  const previewBlocker = snapshot.previewBlockers[0];
  if (previewBlocker !== undefined || snapshot.fontFamily === undefined) {
    return (
      <AbsoluteFill style={{ fontFamily: snapshot.fontFamily }} data-testid="composition-blocker">
        <CompositionState
          tone="danger"
          label="PREVIEW 已阻断"
          title="字体或文字 Preset 无法解析"
          detail={`${previewBlocker?.message ?? "项目字体无法解析。"} 请在项目主题或 Scene 文字表现中恢复内置版本。`}
        />
      </AbsoluteFill>
    );
  }
  return (
    <ReadyProjectComposition
      key={`${snapshot.mode}:${snapshot.fontFamily}`}
      snapshot={snapshot}
      fontFamily={snapshot.fontFamily}
    />
  );
}
