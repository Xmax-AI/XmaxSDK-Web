//
//  CameraFrameGeometry.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

type FrameSize = Readonly<{ width: number; height: number }>;

/** Dimensions measured when the first camera frame is drawn. */
export interface CameraFrameGeometry {
  readonly requested?: FrameSize;
  readonly source: FrameSize;
  readonly crop: FrameSize;
  readonly output: FrameSize;
}

/** First-frame measurements associated with processed camera tracks. */
export const cameraFrameGeometryByTrack = new WeakMap<MediaStreamTrack, CameraFrameGeometry>();
