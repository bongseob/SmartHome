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
 * - publish(카메라/mock-camera → mediamtx RTSP 수신)는 내부망 트래픽이라 무조건 허용한다 —
 *   카메라 자체는 우리 인증 체계를 모른다(순수 RTSP 송출기).
 * - read(뷰어 재생 요청)만 `GET /api/v1/cameras/:id/stream`(apps/api)이 발급한 단기 서명
 *   토큰을 검사한다. 토큰은 `Authorization: Bearer`(MediaMTX가 `token` 필드로 넘겨줌) 또는
 *   임의 사용자명 + 토큰을 비밀번호로 쓰는 Basic 인증(`password` 필드) 둘 다 지원한다
 *   (mediamtx.org 문서의 "pass the token as password" 방식).
 * - 토큰의 `path` 클레임이 실제 요청 path와 다르면 거부한다 — 카메라A용 토큰으로 카메라B를
 *   보는 것을 막는다.
 */
export function decideAuth(
  payload: MediaMtxAuthRequest,
  secret: string | undefined,
  nowSeconds?: number,
): 204 | 401 | 500 {
  if (!secret) {
    console.error("[media-gateway] AUTH_JWT_SECRET 미설정 — read 인증을 검증할 수 없어 거부");
    return 500;
  }

  if (payload.action !== "read") {
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
