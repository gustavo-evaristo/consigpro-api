import * as bcrypt from 'bcrypt';

export class Password {
  private readonly _value: string;

  private static readonly SALT_ROUNDS = 10;
  private static readonly MIN_LENGTH = 6;
  private static readonly SPECIAL_CHAR_REGEX =
    /[!@#$%^&*(),.?":{}|<>_\-\\[\]/+=~`]/;

  private constructor(value: string) {
    this._value = value;
  }

  /**
   * Cria uma senha validando regras de negócio
   */
  public static create(plainPassword: string): Password {
    this.validate(plainPassword);
    return new Password(plainPassword);
  }

  /**
   * Criação para cadastro com confirmação
   */
  public static createWithConfirmation(
    password: string,
    confirmPassword: string,
  ): Password {
    this.validate(password);

    if (password !== confirmPassword) {
      throw new Error('Passwords do not match');
    }

    return new Password(password);
  }

  /**
   * Cria um objeto Password a partir de um hash já existente (banco)
   */
  public static fromHash(hash: string): Password {
    return new Password(hash);
  }

  /**
   * Gera hash da senha
   */
  public hash(): string {
    return bcrypt.hashSync(this._value, Password.SALT_ROUNDS);
  }

  /**
   * Compara senha enviada com hash existente
   */
  public compareWithHash(hash: string): boolean {
    return bcrypt.compareSync(this._value, hash);
  }

  /**
   * Valida regras da senha
   */
  private static validate(password: string): void {
    if (!password || password.length < this.MIN_LENGTH) {
      throw new Error(
        `Password must be at least ${this.MIN_LENGTH} characters long`,
      );
    }

    if (!this.SPECIAL_CHAR_REGEX.test(password)) {
      throw new Error('Password must contain at least one special character');
    }
  }

  get value(): string {
    return this._value;
  }
}
