export type StrictJsonLimits = {
  maxDepth: number;
  maxArrayItems: number;
  maxObjectFields: number;
  maxNodes: number;
  maxStringScalars: number;
  maxStringBytes: number;
  maxNumberBytes: number;
  forbidArrays?: boolean;
};

export type StrictJsonFailureCode =
  | "PROJECT_CONTROL_FILE_INVALID_JSON"
  | "PROJECT_CONTROL_FILE_DUPLICATE_FIELD"
  | "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED";

export class StrictJsonFailure extends Error {
  constructor(
    readonly code: StrictJsonFailureCode,
    message: string,
    readonly jsonPath: string,
    readonly metric?: string,
    readonly actual?: number,
    readonly limit?: number,
  ) {
    super(message);
    this.name = "StrictJsonFailure";
  }
}

function childPath(parent: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/u.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`;
}

function utf8Length(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

export function parseStrictJson(input: string, limits: StrictJsonLimits): unknown {
  let cursor = 0;
  let arrayItems = 0;
  let objectFields = 0;
  let nodes = 0;

  const invalid = (message: string, path: string): never => {
    throw new StrictJsonFailure("PROJECT_CONTROL_FILE_INVALID_JSON", message, path);
  };
  const exceeded = (
    metric: string,
    actual: number,
    limit: number,
    path: string,
  ): never => {
    throw new StrictJsonFailure(
      "PROJECT_CONTROL_FILE_LIMIT_EXCEEDED",
      `JSON 的 ${metric} 为 ${actual}，超过上限 ${limit}；请缩减该内容后重试。`,
      path,
      metric,
      actual,
      limit,
    );
  };
  const whitespace = (): void => {
    while (cursor < input.length && /[\u0009\u000a\u000d\u0020]/u.test(input[cursor]!)) cursor += 1;
  };
  const accountNode = (path: string): void => {
    nodes += 1;
    if (nodes > limits.maxNodes) exceeded("nodes", nodes, limits.maxNodes, path);
  };
  const accountString = (scalars: number, bytes: number, path: string): void => {
    if (scalars > limits.maxStringScalars) {
      exceeded("stringScalars", scalars, limits.maxStringScalars, path);
    }
    if (bytes > limits.maxStringBytes) {
      exceeded("stringBytes", bytes, limits.maxStringBytes, path);
    }
  };

  const stringToken = (path: string, decode: boolean): string | undefined => {
    const start = cursor;
    if (input[cursor] !== '"') invalid("JSON 字符串缺少起始引号。", path);
    cursor += 1;
    let scalars = 0;
    let bytes = 0;
    while (cursor < input.length) {
      const codeUnit = input.charCodeAt(cursor);
      if (codeUnit === 0x22) {
        cursor += 1;
        accountString(scalars, bytes, path);
        return decode ? JSON.parse(input.slice(start, cursor)) as string : undefined;
      }
      if (codeUnit < 0x20) invalid("JSON 字符串包含未转义控制字符。", path);
      if (codeUnit === 0x5c) {
        const escape = input[cursor + 1];
        if (escape === undefined) invalid("JSON 字符串包含未完成的转义。", path);
        if ('"\\/bfnrt'.includes(escape)) {
          scalars += 1;
          bytes += 1;
          cursor += 2;
          accountString(scalars, bytes, path);
          continue;
        }
        if (escape !== "u") invalid("JSON 字符串包含非法转义。", path);
        const firstHex = input.slice(cursor + 2, cursor + 6);
        if (!/^[0-9a-fA-F]{4}$/u.test(firstHex)) invalid("JSON 字符串包含非法 Unicode 转义。", path);
        const first = Number.parseInt(firstHex, 16);
        let codePoint = first;
        let width = 6;
        if (first >= 0xd800 && first <= 0xdbff) {
          if (input.slice(cursor + 6, cursor + 8) !== "\\u") {
            invalid("JSON 字符串包含孤立的高位代理项。", path);
          }
          const secondHex = input.slice(cursor + 8, cursor + 12);
          if (!/^[0-9a-fA-F]{4}$/u.test(secondHex)) invalid("JSON 字符串包含非法 Unicode 转义。", path);
          const second = Number.parseInt(secondHex, 16);
          if (second < 0xdc00 || second > 0xdfff) invalid("JSON 字符串包含孤立的高位代理项。", path);
          codePoint = 0x10000 + ((first - 0xd800) << 10) + second - 0xdc00;
          width = 12;
        } else if (first >= 0xdc00 && first <= 0xdfff) {
          invalid("JSON 字符串包含孤立的低位代理项。", path);
        }
        scalars += 1;
        bytes += utf8Length(codePoint);
        cursor += width;
        accountString(scalars, bytes, path);
        continue;
      }
      let codePoint = codeUnit;
      let width = 1;
      if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        const second = input.charCodeAt(cursor + 1);
        if (!(second >= 0xdc00 && second <= 0xdfff)) invalid("JSON 字符串包含孤立的高位代理项。", path);
        codePoint = 0x10000 + ((codeUnit - 0xd800) << 10) + second - 0xdc00;
        width = 2;
      } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        invalid("JSON 字符串包含孤立的低位代理项。", path);
      }
      scalars += 1;
      bytes += utf8Length(codePoint);
      cursor += width;
      accountString(scalars, bytes, path);
    }
    return invalid("JSON 字符串缺少结束引号。", path);
  };

  const parseValue = (depth: number, path: string): void => {
    if (depth > limits.maxDepth) exceeded("depth", depth, limits.maxDepth, path);
    accountNode(path);
    whitespace();
    const current = input[cursor];
    if (current === "{") {
      cursor += 1;
      whitespace();
      const keys = new Set<string>();
      if (input[cursor] === "}") {
        cursor += 1;
        return;
      }
      while (true) {
        whitespace();
        const key = stringToken(path, true)!;
        const valuePath = childPath(path, key);
        objectFields += 1;
        if (objectFields > limits.maxObjectFields) {
          exceeded("objectFields", objectFields, limits.maxObjectFields, valuePath);
        }
        if (keys.has(key)) {
          throw new StrictJsonFailure(
            "PROJECT_CONTROL_FILE_DUPLICATE_FIELD",
            `JSON 字段 ${valuePath} 重复；请只保留一个字段。`,
            valuePath,
          );
        }
        keys.add(key);
        whitespace();
        if (input[cursor] !== ":") invalid("JSON 对象字段名后缺少冒号。", valuePath);
        cursor += 1;
        parseValue(depth + 1, valuePath);
        whitespace();
        if (input[cursor] === "}") {
          cursor += 1;
          return;
        }
        if (input[cursor] !== ",") invalid("JSON 对象字段之间缺少逗号。", path);
        cursor += 1;
      }
    }
    if (current === "[") {
      if (limits.forbidArrays) exceeded("arrays", 1, 0, path);
      cursor += 1;
      whitespace();
      if (input[cursor] === "]") {
        cursor += 1;
        return;
      }
      let index = 0;
      while (true) {
        arrayItems += 1;
        if (arrayItems > limits.maxArrayItems) {
          exceeded("arrayItems", arrayItems, limits.maxArrayItems, `${path}[${index}]`);
        }
        parseValue(depth + 1, `${path}[${index}]`);
        index += 1;
        whitespace();
        if (input[cursor] === "]") {
          cursor += 1;
          return;
        }
        if (input[cursor] !== ",") invalid("JSON 数组项之间缺少逗号。", path);
        cursor += 1;
      }
    }
    if (current === '"') {
      stringToken(path, false);
      return;
    }
    for (const literal of ["true", "false", "null"]) {
      if (input.startsWith(literal, cursor)) {
        cursor += literal.length;
        return;
      }
    }
    const number = input.slice(cursor).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u)?.[0];
    if (number !== undefined) {
      if (number.length > limits.maxNumberBytes) {
        exceeded("numberBytes", number.length, limits.maxNumberBytes, path);
      }
      cursor += number.length;
      return;
    }
    invalid("JSON 包含非法值。", path);
  };

  whitespace();
  parseValue(1, "$");
  whitespace();
  if (cursor !== input.length) invalid("JSON 根值后存在额外内容。", "$");
  return JSON.parse(input) as unknown;
}
