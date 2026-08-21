import { Composition, registerRoot } from "remotion";

import { DEFAULT_PROJECT_THEME, type Project } from "../shared/project";
import { ProjectComposition } from "./ProjectComposition";
import {
  VideoNormalizationComposition,
  type VideoNormalizationProps,
} from "./VideoNormalizationComposition";
import {
  createRenderSnapshot,
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  type RenderSnapshot,
} from "./render-snapshot";

const EMPTY_PROJECT: Project = {
  schemaVersion: 3,
  metadata: {},
  theme: DEFAULT_PROJECT_THEME,
  assets: [],
  scenes: [],
};

const defaultSnapshot = createRenderSnapshot(EMPTY_PROJECT, "http://127.0.0.1/media/");

function RemotionRoot() {
  return (
    <>
      <Composition
        id="NarracutProject"
        component={ProjectComposition}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        fps={VIDEO_FPS}
        durationInFrames={1}
        defaultProps={{ snapshot: defaultSnapshot }}
        calculateMetadata={({ props }) => ({
          durationInFrames: props.snapshot.durationInFrames,
          width: props.snapshot.width,
          height: props.snapshot.height,
          fps: props.snapshot.fps,
        })}
      />
      <Composition
        id="NarracutNormalizeVideo"
        component={VideoNormalizationComposition}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        fps={VIDEO_FPS}
        durationInFrames={1}
        defaultProps={{ src: "", durationInFrames: 1 }}
        calculateMetadata={({ props }) => ({
          durationInFrames: Math.max(1, Math.ceil(props.durationInFrames)),
          width: VIDEO_WIDTH,
          height: VIDEO_HEIGHT,
          fps: VIDEO_FPS,
        })}
      />
    </>
  );
}

registerRoot(RemotionRoot);

export type NarracutCompositionProps = { snapshot: RenderSnapshot };
export type NarracutVideoNormalizationProps = VideoNormalizationProps;
