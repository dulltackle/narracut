import { describe, expect, it } from "vitest";

import {
  inspectVideoSource,
  requiresVideoEnlargement,
  type VideoProbeResult,
} from "../src/server/video-media";

function probe(
  video: Partial<NonNullable<VideoProbeResult["streams"]>[number]> = {},
  streams: VideoProbeResult["streams"] | undefined = undefined,
): VideoProbeResult {
  return {
    format: {
      format_name: "mov,mp4,m4a,3gp,3g2,mj2",
      duration: "2.000000",
      tags: { major_brand: "isom", compatible_brands: "isomiso2avc1mp41" },
    },
    streams:
      streams ??
      [{
        index: 0,
        codec_type: "video",
        codec_name: "h264",
        profile: "High",
        level: 41,
        pix_fmt: "yuv420p",
        width: 1920,
        height: 1080,
        r_frame_rate: "30/1",
        avg_frame_rate: "30/1",
        sample_aspect_ratio: "1:1",
        color_range: "tv",
        color_space: "bt709",
        color_transfer: "bt709",
        color_primaries: "bt709",
        field_order: "progressive",
        nb_frames: "60",
        duration: "2.000000",
        disposition: { attached_pic: 0 },
        ...video,
      }],
  };
}

describe("视频导入事实判定", () => {
  it("识别可 remux 的唯一目标 profile，并允许来源音轨被移除", () => {
    const result = inspectVideoSource(probe({}, [
      probe().streams![0],
      { index: 1, codec_type: "audio", codec_name: "aac" },
    ]));

    expect(result).toMatchObject({
      streamIndex: 0,
      codec: "h264",
      sourceWidth: 1920,
      sourceHeight: 1080,
      durationSeconds: 2,
      remuxEligible: true,
      enlarged: false,
    });
  });

  it("HEVC Main 10 合规但必须转码", () => {
    const result = inspectVideoSource(probe({
      codec_name: "hevc",
      profile: "Main 10",
      pix_fmt: "yuv420p10le",
    }));

    expect(result.codec).toBe("hevc");
    expect(result.remuxEligible).toBe(false);
  });

  it("流级场序缺失时以编码头事实确认逐行 HEVC", () => {
    const input = probe({
      codec_name: "hevc",
      profile: "Main 10",
      pix_fmt: "yuv420p10le",
      field_order: undefined,
    });
    input.frameEncoding = "progressive";

    expect(inspectVideoSource(input)).toMatchObject({
      codec: "hevc",
      remuxEligible: false,
    });
  });

  it("流级场序缺失但编码头表明隔行时仍拒绝", () => {
    const input = probe({ field_order: undefined });
    input.frameEncoding = "interlaced";

    expect(() => inspectVideoSource(input)).toThrow(
      expect.objectContaining({ code: "VIDEO_INTERLACED_UNSUPPORTED" }),
    );
  });

  it("应用旋转后的尺寸判定低分辨率放大", () => {
    const result = inspectVideoSource(probe({
      width: 1080,
      height: 1920,
      side_data_list: [{ rotation: 90 }],
    }));

    expect(result).toMatchObject({
      sourceWidth: 1920,
      sourceHeight: 1080,
      rotation: 90,
      enlarged: false,
      remuxEligible: false,
    });
    expect(requiresVideoEnlargement(640, 480)).toBe(true);
    expect(requiresVideoEnlargement(2560, 1080)).toBe(false);
  });

  it("从任意 Display Matrix 项读取旋转，并拒绝无法无损应用的角度", () => {
    expect(inspectVideoSource(probe({
      side_data_list: [{}, { rotation: 270 }],
    })).rotation).toBe(270);
    expect(() => inspectVideoSource(probe({
      side_data_list: [{ rotation: 45 }],
    }))).toThrow(expect.objectContaining({ code: "VIDEO_ROTATION_UNSUPPORTED" }));
  });

  it("优先使用视频轨时长，避免较长音轨扩大转码范围", () => {
    const input = probe({}, [
      { ...probe().streams![0], duration: "1.000000" },
      { index: 1, codec_type: "audio", codec_name: "aac", duration: "3600.000000" },
    ]);
    input.format!.duration = "3600.000000";
    expect(inspectVideoSource(input).durationSeconds).toBe(1);
  });

  it("拒绝共享 ISO-BMFF 探测名下的 3GP 品牌", () => {
    const input = probe();
    input.format!.tags = { major_brand: "3gp4" };
    expect(() => inspectVideoSource(input)).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_VIDEO_CONTAINER" }),
    );
  });

  it.each([
    ["UNSUPPORTED_VIDEO_CONTAINER", probe({}, [{ ...probe().streams![0] }])],
    ["VIDEO_TRACK_COUNT_INVALID", probe({}, [probe().streams![0], { ...probe().streams![0], index: 1 }])],
    ["VIDEO_CODEC_UNSUPPORTED", probe({ codec_name: "vp9" })],
    ["VIDEO_CHROMA_UNSUPPORTED", probe({ pix_fmt: "yuv422p" })],
    ["VIDEO_HDR_UNSUPPORTED", probe({ color_transfer: "smpte2084", color_primaries: "bt2020" })],
    ["VIDEO_ALPHA_UNSUPPORTED", probe({ pix_fmt: "yuva420p" })],
    ["VIDEO_INTERLACED_UNSUPPORTED", probe({ field_order: "tt" })],
  ])("拒绝不合规输入：%s", (code, input) => {
    if (code === "UNSUPPORTED_VIDEO_CONTAINER") {
      input.format = { ...input.format, format_name: "matroska,webm" };
    }
    expect(() => inspectVideoSource(input)).toThrow(expect.objectContaining({ code }));
  });

  it("忽略封面视频流，但拒绝两路真实视频轨", () => {
    const cover = { ...probe().streams![0], index: 1, disposition: { attached_pic: 1 } };
    expect(inspectVideoSource(probe({}, [probe().streams![0], cover])).streamIndex).toBe(0);
  });
});
