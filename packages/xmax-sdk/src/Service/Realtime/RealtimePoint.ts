export interface RealtimePointInit {
  /**
   * 媒体横坐标；摄像头和本地文件为 [0, 1] 归一化值。
   */
  x: number;

  /**
   * 媒体纵坐标；摄像头和本地文件为 [0, 1] 归一化值。
   */
  y: number;
}

/**
 * 媒体坐标系中的二维点；网络视频和外部轨道暂时保留像素坐标。
 */
export class RealtimePoint {
  /**
   * 坐标
   */
  /**
   * 媒体横坐标。
   */
  readonly x: number;

  /**
   * 媒体纵坐标。
   */
  readonly y: number;

  /**
   * 创建媒体坐标点。
   *
   * @param init.x 媒体横坐标。
   * @param init.y 媒体纵坐标。
   */
  constructor(init: RealtimePointInit) {
    this.x = init.x;
    this.y = init.y;
  }
}
