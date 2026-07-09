import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";

interface ResponseLike {
  status(code: number): ResponseLike;
  type(contentType: string): ResponseLike;
  json(body: unknown): void;
}

interface RequestLike {
  url?: string;
}

interface ProblemBody {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  instance: string;
}

function problemTitle(status: number): string {
  if (status === HttpStatus.BAD_REQUEST) return "Bad Request";
  if (status === HttpStatus.NOT_FOUND) return "Not Found";
  if (status === HttpStatus.UNAUTHORIZED) return "Unauthorized";
  if (status === HttpStatus.FORBIDDEN) return "Forbidden";
  return status >= 500 ? "Internal Server Error" : "Request Error";
}

function exceptionDetail(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === "string") {
    return response;
  }
  if (typeof response === "object" && response !== null && "message" in response) {
    const message = (response as { message: unknown }).message;
    return Array.isArray(message) ? message.join("; ") : String(message);
  }
  return exception.message;
}

@Catch()
export class ProblemJsonFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<ResponseLike>();
    const request = context.getRequest<RequestLike>();
    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const detail = isHttp ? exceptionDetail(exception) : "Unexpected server error";
    const title = problemTitle(status);
    const body: ProblemBody = {
      type: `https://smarthome.local/problems/${status}`,
      title,
      status,
      code: title.toUpperCase().replaceAll(" ", "_"),
      detail,
      instance: request.url ?? "",
    };

    response.status(status).type("application/problem+json").json(body);
  }
}
