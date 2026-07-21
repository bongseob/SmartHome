import { timingSafeEqual } from "node:crypto";
import { verifyStreamToken } from "@smarthome/auth";

export interface MediaMtxAuthRequest {
  user?: string;
  password?: string;
  token?: string;
  ip?: string;
  action?: string;
  path?: string;
  protocol?: string;
  id?: string;
  query?: string;
  userAgent?: string;
}

/**
 * MediaMTX `authHTTPAddress` 웹훅 판정(mediamtx.org "usage/authentication" §HTTP-based).
 * MediaMTX가 read/publish 등 모든 액션마다 POST로 이 URL을 호출하고, 20x면 허용·그 외엔 거부한다.
 * HTTP I/O와 분리한 순수 함수라 실제 서버 없이 테스트 가능하다(index.ts가 이 반환값으로
 * response status를 그대로 쓴다).
 *
 * - publish(카메라/mock-camera → mediamtx RTSP 수신)는 공유 발행 자격증명
 *   (`MEDIAMTX_PUBLISH_USERNAME`/`MEDIAMTX_PUBLISH_PASSWORD`, Mosquitto의 `svc-backend`
 *   공용 계정과 같은 성격)을 검사한다 — 자격증명 없이는 아무나 RTSP publish로 스트림을
 *   주입/덮어쓸 수 있었던 문제(코드 리뷰 P1)를 막는다. 다만 이 값은 "공유" 비밀이라
 *   카메라별 신원까지는 구분 못 한다(자격증명을 아는 다른 publisher가 같은 path를 덮어쓰는
 *   것까지는 못 막음) — 카메라별 자격증명 + path 바인딩은 후속 과제로 남겨둔다.
 * - read(뷰어 재생 요청)만 `GET /api/v1/cameras/:id/stream`(apps/api)이 발급한 단기 서명
 *   토큰을 검사한다. 토큰은 `Authorization: Bearer`(MediaMTX가 `token` 필드로 넘겨줌) 또는
 *   임의 사용자명 + 토큰을 비밀번호로 쓰는 Basic 인증(`password` 필드) 둘 다 지원한다
 *   (mediamtx.org 문서의 "pass the token as password" 방식).
 * - 토큰의 `path` 클레임이 실제 요청 path와 다르면 거부한다 — 카메라A용 토큰으로 카메라B를
 *   보는 것을 막는다.
 */
export interface PublishCredentials {
  username: string;
  password: string;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function decideAuth(
  payload: MediaMtxAuthRequest,
  secret: string | undefined,
  nowSeconds?: number,
  publishCredentials?: PublishCredentials,
): 204 | 401 | 500 {
  if (!secret) {
    console.error("[media-gateway] AUTH_JWT_SECRET 미설정 — read 인증을 검증할 수 없어 거부");
    return 500;
  }

  if (payload.action === "publish") {
    if (!publishCredentials) {
      console.error(
        "[media-gateway] MEDIAMTX_PUBLISH_USERNAME/PASSWORD 미설정 — publish 인증을 검증할 수 없어 거부",
      );
      return 401;
    }
    const user = payload.user ?? "";
    const password = payload.password ?? "";
    if (!safeEqual(user, publishCredentials.username) || !safeEqual(password, publishCredentials.password)) {
      return 401;
    }
    return 204;
  }

  // "playback"도 저장된 영상(녹화본)에 접근하는 액션이라 read와 같은 토큰 검사를 적용한다
  // (코드 리뷰 P2 #20) — 예전엔 read 이외 모든 액션을 무조건 허용해서, 지금은 꺼져 있는
  // mediamtx.yml의 playback 서버가 나중에 켜지면 토큰 없이도 녹화 영상에 접근할 수 있는
  // 잠재 위험이 있었다. api/metrics/pprof는 mediamtx.yml의 authHTTPExclude가 애초에 이
  // 웹훅 호출 자체를 건너뛰므로(도달 시 방어적으로 허용) 기존 동작을 그대로 둔다.
  if (payload.action !== "read" && payload.action !== "playback") {
    return 204;
  }

  const token = payload.token || payload.password;
  if (!token) {
    return 401;
  }

  try {
    const claims = verifyStreamToken(token, secret, nowSeconds);
    if (claims.path !== payload.path) {
      console.warn(
        `[media-gateway] 스트림 토큰-경로 불일치: token.path='${claims.path}' 요청 path='${payload.path}'`,
      );
      return 401;
    }
    return 204;
  } catch (err) {
    console.warn(`[media-gateway] 스트림 토큰 검증 실패: ${(err as Error).message}`);
    return 401;
  }
}
