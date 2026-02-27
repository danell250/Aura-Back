declare module 'cookie' {
  export interface ParseOptions {
    decode?(value: string): string;
    map?: boolean;
  }

  export interface SerializeOptions {
    encode?(value: string): string;
    maxAge?: number;
    expires?: Date;
    domain?: string;
    path?: string;
    httpOnly?: boolean;
    secure?: boolean;
    partitioned?: boolean;
    priority?: 'low' | 'medium' | 'high';
    sameSite?: boolean | 'lax' | 'strict' | 'none';
  }

  export function parse(str: string, options?: ParseOptions): Record<string, string>;
  export function serialize(name: string, value: string, options?: SerializeOptions): string;
}
