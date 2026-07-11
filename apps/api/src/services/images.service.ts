import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import {
  deleteImage,
  insertAuditLog,
  insertImage,
  listImages,
  query,
} from "@smarthome/db";

const imageExecutor = { query };

export interface CreateImageInput {
  name: string;
  imageUrl: string;
  widthPx: number | null;
  heightPx: number | null;
}

/** addendum §2.1 · PROJECT_RULES §6 — 이미지 라이브러리 관리는 ADMIN 전용, 변경은 감사 대상. */
@Injectable()
export class ImagesService {
  async list(): Promise<unknown> {
    return listImages(imageExecutor);
  }

  async create(input: CreateImageInput, auth: AuthContext): Promise<unknown> {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (name.length === 0) throw new BadRequestException("name is required");

    const image = await insertImage(imageExecutor, {
      name,
      imageUrl: input.imageUrl,
      widthPx: Number.isFinite(input.widthPx) ? input.widthPx : null,
      heightPx: Number.isFinite(input.heightPx) ? input.heightPx : null,
      uploadedBy: auth.userId,
    });
    await this.audit(auth, "CREATE_IMAGE", image.id, `image '${image.name}' uploaded`);
    return image;
  }

  /** DB row 삭제 후, 파일 unlink는 컨트롤러가 반환된 imageUrl로 수행한다. */
  async remove(id: string, auth: AuthContext): Promise<{ imageUrl: string }> {
    const removed = await deleteImage(imageExecutor, id);
    if (!removed) throw new NotFoundException(`image not found: ${id}`);
    await this.audit(auth, "DELETE_IMAGE", id, `image '${removed.name}' deleted`);
    return { imageUrl: removed.imageUrl };
  }

  private async audit(auth: AuthContext, command: string, targetId: string, reason: string): Promise<void> {
    await insertAuditLog(imageExecutor, {
      actorType: "ADMIN",
      actorId: auth.userId,
      targetType: "IMAGE",
      targetId,
      command,
      reason,
      executionStatus: "SUCCEEDED",
      mqttReasonCode: null,
      sessionId: null,
      commandId: null,
    });
  }
}
