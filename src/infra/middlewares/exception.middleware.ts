import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';

@Catch(Error)
export class CustomExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();

    const message = exception?.response?.message || exception?.message;

    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : 400;

    response.status(statusCode).json({
      statusCode,
      message,
    });
  }
}
