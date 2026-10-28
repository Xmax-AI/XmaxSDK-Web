//
//  XmaxRealtimeVideo.tsx
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import {
  VideoContentMode,
  XmaxRealtimeVideoView,
  type RealtimeVideoTrack,
  type TrajectoryEffectRendering,
  type VideoRenderStatistics,
} from "../index";
import {
  useEffect,
  useRef,
  type CSSProperties,
} from "react";

/**
 * Track, presentation, and interaction options for the single-track React component.
 */
export interface XmaxRealtimeVideoProps {

  /**
   * The displayed track; undefined clears video.
   */
  track?: RealtimeVideoTrack;

  /**
   * The video layout mode; defaults to fill.
   */
  videoContentMode?: VideoContentMode;

  /**
   * Whether display is mirrored without affecting publication.
   */
  mirrored?: boolean;

  /**
   * The current view's presentation statistics, cleared on replacement or detachment and independent of
   * statistics-panel visibility.
   */
  onRenderStatistics?: (
    statistics?: VideoRenderStatistics
  ) => void;

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
 * A React component rendering one video track. SDK remote tracks warm up before fading in; local preview
 * displays immediately.
 */
export function XmaxRealtimeVideo(
  props: XmaxRealtimeVideoProps
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<XmaxRealtimeVideoView | undefined>(undefined);

  useEffect(
    () => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const view = new XmaxRealtimeVideoView();
      view.element.style.width = "100%";
      view.element.style.height = "100%";
      view.attach(container);
      viewRef.current = view;
      return () => {
        viewRef.current = undefined;
        view.track = undefined;
        view.detach();
      };
    },
    []
  );

  useEffect(
    () => {
      if (viewRef.current) {
        viewRef.current.renderStatisticsHandler = props.onRenderStatistics;
      }
    },
    [props.onRenderStatistics]
  );

  useEffect(
    () => {
      const view = viewRef.current;
      if (view) {
        view.track = props.track;
      }
    },
    [props.track]
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
      const view = viewRef.current;
      if (view && props.mirrored !== undefined) {
        view.isMirrored = props.mirrored;
      }
    },
    [props.mirrored]
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
