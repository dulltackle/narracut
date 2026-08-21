import { Video } from "@remotion/media";
import { AbsoluteFill } from "remotion";

export type VideoNormalizationProps = {
  src: string;
  durationInFrames: number;
};

export function VideoNormalizationComposition({ src }: VideoNormalizationProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: "#2A2226" }}>
      <Video
        src={src}
        muted
        loop={false}
        disallowFallbackToOffthreadVideo
        objectFit="contain"
        style={{ width: "100%", height: "100%" }}
        onError={() => "fail"}
      />
    </AbsoluteFill>
  );
}
