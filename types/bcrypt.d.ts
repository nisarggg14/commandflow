declare module "bcrypt" {
  export function hash(password: string, saltRounds: number): Promise<string>;
  export function compare(password: string, hashedPassword: string): Promise<boolean>;
  const bcrypt: {
    hash: typeof hash;
    compare: typeof compare;
  };
  export default bcrypt;
}
