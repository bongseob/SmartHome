/**
 * `onvif`(npm, agsh/onvif)는 자체 타입 정의를 제공하지 않고 `@types/onvif`도 없다.
 * 여기서는 camera-adapter.ts가 실제로 쓰는 표면만 최소로 선언한다 — 전체 API의 타입 셰이프가
 * 아니라 우리가 호출하는 부분만 정확하면 된다(콜백 시그니처는 실제 lib/ptz.js 소스로 확인함).
 */
declare module "onvif" {
  export interface CamOptions {
    hostname: string;
    username?: string | undefined;
    password?: string | undefined;
    port?: number | undefined;
    path?: string | undefined;
    timeout?: number | undefined;
  }

  export interface PtzVector {
    x?: number;
    y?: number;
    zoom?: number;
    profileToken?: string;
    speed?: { x?: number; y?: number; zoom?: number };
  }

  export interface PtzStopOptions {
    panTilt?: boolean;
    zoom?: boolean;
    profileToken?: string;
  }

  export class Cam {
    constructor(options: CamOptions, callback: (this: Cam, err: Error | null) => void);
    relativeMove(options: PtzVector, callback: (this: Cam, err: Error | null) => void): void;
    absoluteMove(options: PtzVector, callback: (this: Cam, err: Error | null) => void): void;
    continuousMove(options: PtzVector, callback: (this: Cam, err: Error | null) => void): void;
    stop(options: PtzStopOptions, callback: (this: Cam, err: Error | null) => void): void;
  }
}
