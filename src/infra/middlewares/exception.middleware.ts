import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import { isBoom } from '@hapi/boom';

@Catch(Error)
export class CustomExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();

    if (isBoom(exception)) {
      const statusCode = exception.output.statusCode;
      response.status(statusCode).json({
        statusCode,
        message: exception.message,
        ...(exception.data ? { data: exception.data } : {}),
      });
      return;
    }

    const message = exception?.response?.message || exception?.message;

    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : 400;

    response.status(statusCode).json({
      statusCode,
      message,
    });
  }
}
