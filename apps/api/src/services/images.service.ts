import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthContext } from "@smarthome/auth";
import {
  deleteImage,
  getImageById,
  insertAuditLog,
  insertImage,
  listImages,
  query,
  updateImage,
  type ImageRecord,
} from "@smarthome/db";

const imageExecutor = { query };

export interface CreateImageInput {
  name: string;
  description?: string | null;
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
      description: input.description?.trim() || null,
      imageUrl: input.imageUrl,
      widthPx: Number.isFinite(input.widthPx) ? input.widthPx : null,
      heightPx: Number.isFinite(input.heightPx) ? input.heightPx : null,
      uploadedBy: auth.userId,
    });
    await this.audit(auth, "CREATE_IMAGE", image.id, `image '${image.name}' uploaded`);
    return image;
  }

  /**
   * 이름 수정 및/또는 파일 교체 — id(키)는 그대로 유지한다. area.image_id 등 이 이미지를 참조하는
   * 쪽은 아무것도 바꾸지 않아도 다음 조회부터 새 파일을 그대로 보게 된다. 파일이 실제로 교체된
   * 경우에만 이전 파일의 unlink를 컨트롤러가 하도록 previousImageUrl을 돌려준다.
   */
  async update(
    id: string,
    input: {
      name?: string | undefined;
      description?: string | null | undefined;
      imageUrl?: string | undefined;
      widthPx?: number | null | undefined;
      heightPx?: number | null | undefined;
    },
    auth: AuthContext,
  ): Promise<{ image: ImageRecord; previousImageUrl: string | null }> {
    const before = await getImageById(imageExecutor, id);
    if (!before) throw new NotFoundException(`image not found: ${id}`);

    const name = input.name !== undefined ? input.name.trim() : undefined;
    if (name !== undefined && name.length === 0) {
      throw new BadRequestException("name must not be empty");
    }

    const image = await updateImage(imageExecutor, id, {
      ...(name !== undefined ? { name } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
      ...(input.widthPx !== undefined ? { widthPx: input.widthPx } : {}),
      ...(input.heightPx !== undefined ? { heightPx: input.heightPx } : {}),
    });
    if (!image) throw new NotFoundException(`image not found: ${id}`);

    const fileReplaced = input.imageUrl !== undefined && input.imageUrl !== before.imageUrl;
    const nameChanged = name !== undefined && name !== before.name;
    const descriptionChanged = input.description !== undefined && input.description !== before.description;
    await this.audit(
      auth,
      fileReplaced ? "REPLACE_IMAGE_FILE" : "UPDATE_IMAGE",
      id,
      [
        nameChanged ? `name '${before.name}' → '${name}'` : null,
        descriptionChanged ? `description → '${input.description ?? "null"}'` : null,
        fileReplaced ? `file '${before.imageUrl}' → '${input.imageUrl}'` : null,
      ].filter(Boolean).join(", ") || `image '${before.name}' updated (no-op)`,
    );
    return { image, previousImageUrl: fileReplaced ? before.imageUrl : null };
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
