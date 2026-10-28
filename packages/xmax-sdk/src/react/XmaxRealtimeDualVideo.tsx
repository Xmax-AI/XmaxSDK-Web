//
//  XmaxRealtimeDualVideo.tsx
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import {
  VideoContentMode,
  XmaxRealtimeDualVideoView,
  type RealtimeVideoTrack,
  type TrajectoryEffectRendering,
} from "../index";
import {
  useEffect,
  useRef,
  type CSSProperties,
} from "react";

/**
 * Local and remote tracks and presentation options for the dual-track React component.
 */
export interface XmaxRealtimeDualVideoProps {

  /**
   * The displayed local track.
   */
  localTrack?: RealtimeVideoTrack;

  /**
   * The generated remote track, faded in after first-frame readiness.
   */
  remoteTrack?: RealtimeVideoTrack;

  /**
   * The remote fade duration in seconds, defaulting to 0.3. Nonpositive or nonfinite values disable
   * animation without skipping warmup.
   */
  remoteVideoFadeInDuration?: number;

  /**
   * The video layout mode; defaults to fill.
   */
  videoContentMode?: VideoContentMode;

  /**
   * The container class name.
   */
  className?: string;

  /**
   * Whether remote interaction is permitted; defaults to true and does not affect local tracks.
   */
  isInteractionEnabled?: boolean;

  /**
   * The custom trajectory effect, or the default when omitted. Use one renderer per view.
   */
  trajectoryRenderer?: TrajectoryEffectRendering;

  /**
   * The container style.
   */
  style?: CSSProperties;
}

/**
 * A React component switching automatically between local preview and remote generation.
 */
export function XmaxRealtimeDualVideo(
  props: XmaxRealtimeDualVideoProps
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<XmaxRealtimeDualVideoView | undefined>(undefined);

  useEffect(
    () => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const view = new XmaxRealtimeDualVideoView({ remoteVideoFadeInDuration: props.remoteVideoFadeInDuration });
      view.element.style.width = "100%";
      view.element.style.height = "100%";
      view.attach(container);
      viewRef.current = view;
      return () => {
        viewRef.current = undefined;
        view.localTrack = undefined;
        view.remoteTrack = undefined;
        view.detach();
      };
    },
    []
  );

  useEffect(
    () => {
      if (viewRef.current) {
        viewRef.current.remoteVideoFadeInDuration = props.remoteVideoFadeInDuration ?? 0.3;
      }
    },
    [props.remoteVideoFadeInDuration]
  );

  useEffect(
    () => {
      const view = viewRef.current;
      if (view) {
        view.localTrack = props.localTrack;
      }
    },
    [props.localTrack]
  );

  useEffect(
    () => {
      const view = viewRef.current;
      if (view) {
        view.remoteTrack = props.remoteTrack;
      }
    },
    [props.remoteTrack]
  );

  useEffect(
    () => {
      const view = viewRef.current;
      if (view && props.videoContentMode) {
        view.videoContentMode = props.videoContentMode;
      }
    },
    [props.videoContentMode]
  );

  useEffect(
    () => {
      if (viewRef.current) {
        viewRef.current.isInteractionEnabled = props.isInteractionEnabled ?? true;
      }
    },
    [props.isInteractionEnabled]
  );

  useEffect(
    () => {
      if (viewRef.current) {
        viewRef.current.trajectoryRenderer = props.trajectoryRenderer;
      }
    },
    [props.trajectoryRenderer]
  );

  return (
    <div
      ref={containerRef}
      className={props.className}
      style={{
        position: "relative",
        overflow: "hidden",
        ...props.style
      }}
    />
  );
}
