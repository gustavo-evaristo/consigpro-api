import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/infra/database/database.module';
import { AuthenticationModule } from 'src/infra/authentication/authentication.module';
import {
  CreateFormUseCase,
  ListFormsUseCase,
  FindFormByIdUseCase,
  UpdateFormUseCase,
  DeleteFormUseCase,
  GetPublicFormUseCase,
  SubmitFormResponseUseCase,
  ListFormResponsesUseCase,
  DeleteFormResponseUseCase,
  SetFormActiveUseCase,
} from 'src/domain/use-cases';
import { CreateFormController } from './create-form.controller';
import { ListFormsController } from './list-forms.controller';
import { FindFormByIdController } from './find-form-by-id.controller';
import { UpdateFormController } from './update-form.controller';
import { DeleteFormController } from './delete-form.controller';
import { GetPublicFormController } from './get-public-form.controller';
import { SubmitFormResponseController } from './submit-form-response.controller';
import { ListFormResponsesController } from './list-form-responses.controller';
import { DeleteFormResponseController } from './delete-form-response.controller';
import { SetFormActiveController } from './set-form-active.controller';

@Module({
  providers: [
    CreateFormUseCase,
    ListFormsUseCase,
    FindFormByIdUseCase,
    UpdateFormUseCase,
    DeleteFormUseCase,
    GetPublicFormUseCase,
    SubmitFormResponseUseCase,
    ListFormResponsesUseCase,
    DeleteFormResponseUseCase,
    SetFormActiveUseCase,
  ],
  controllers: [
    CreateFormController,
    ListFormsController,
    FindFormByIdController,
    UpdateFormController,
    DeleteFormController,
    GetPublicFormController,
    SubmitFormResponseController,
    ListFormResponsesController,
    DeleteFormResponseController,
    SetFormActiveController,
  ],
  imports: [DatabaseModule, AuthenticationModule],
})
export class FormModule {}
