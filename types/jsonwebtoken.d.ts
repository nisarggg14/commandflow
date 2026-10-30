declare module "jsonwebtoken" {
  export interface JwtPayload {
    [key: string]: unknown;
    exp?: number;
    iat?: number;
  }

  export function sign(payload: object | string, secretOrPrivateKey: string, options?: { expiresIn?: string | number }): string;
  export function verify(token: string, secretOrPrivateKey: string): JwtPayload;

  const jwt: {
    sign: typeof sign;
    verify: typeof verify;
  };

  export default jwt;
}
