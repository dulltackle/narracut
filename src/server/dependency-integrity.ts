import { createHash } from 'node:crypto';
export class DependencyError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
const fail = (message: string): never => { throw new DependencyError('DEPENDENCY_SOURCE_UNSUPPORTED', message); };
export function integrityKey(integrity: string) {
  if (typeof integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity)) return fail('依赖必须提供规范 SHA-512 完整性摘要。');
  const bytes = Buffer.from(integrity.slice(7), 'base64');
  if (bytes.toString('base64') !== integrity.slice(7)) return fail('依赖完整性摘要不是规范 Base64。');
  return bytes.toString('hex');
}
export function verifyPackageBytes(key: string, bytes: Buffer) {
  if (createHash('sha512').update(bytes).digest('hex') !== key) throw new DependencyError('DEPENDENCY_INTEGRITY_FAILED', '离线依赖包完整性不符；请显式协调修复。');
}
