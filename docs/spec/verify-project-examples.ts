import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  projectV3JsonSchema,
  validateProjectConsistency,
  validateProjectStructure,
  type ProjectV3,
} from "./project-schema-v3.ts";

async function readJson(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(name, import.meta.url), "utf8"));
}

function requireValidProject(input: unknown, name: string): ProjectV3 {
  const structure = validateProjectStructure(input);
  assert.equal(
    structure.success,
    true,
    `${name} 结构校验失败：${JSON.stringify(structure.diagnostics, null, 2)}`,
  );

  if (!structure.success) {
    throw new Error(`${name} 结构校验失败。`);
  }

  const consistency = validateProjectConsistency(structure.project);
  assert.deepEqual(consistency, [], `${name} 内部一致性校验失败。`);
  return structure.project;
}

async function main(): Promise<void> {
  const fixture = requireValidProject(
    await readJson("project.example.json"),
    "真实 13 Scene 示例",
  );
  const ai = requireValidProject(
    await readJson("project.ai-example.json"),
    "20 Scene AI 样本",
  );

  assert.equal(
    fixture.scenes.length,
    13,
    "真实示例必须与 13 Scene 文案夹具一致。",
  );
  assert.equal(ai.scenes.length, 20, "AI 样本必须恰好包含 20 个 Scene。");
  assert.deepEqual(
    ai.assets,
    fixture.assets,
    "AI 样本不得改变给定 Asset catalog。",
  );
  assert.ok(
    ai.scenes.every((scene) => scene.speech === undefined),
    "AI 样本必须全部省略 Speech。",
  );

  const visualTypes = new Set(ai.scenes.map((scene) => scene.visual.type));
  assert.deepEqual(
    visualTypes,
    new Set(["card", "image", "video"]),
    "AI 样本必须覆盖三种 Visual Type。",
  );

  const captions = ai.scenes.flatMap((scene) =>
    scene.visual.type !== "card" && scene.visual.caption !== undefined
      ? [scene.visual.caption]
      : [],
  );
  assert.ok(
    captions.length > 0 && captions.every((caption) => Object.keys(caption).join() === "text"),
    "AI 样本的 Caption 必须统一为单段 text。",
  );

  assert.equal(
    projectV3JsonSchema.$schema,
    "https://json-schema.org/draft/2020-12/schema",
  );
  assert.equal(
    projectV3JsonSchema.additionalProperties,
    false,
    "顶层必须拒绝未知键。",
  );

  const unknownKey = { ...fixture, unexpected: true };
  assert.equal(
    validateProjectStructure(unknownKey).success,
    false,
    "未知键必须导致结构校验失败。",
  );

  const invalidPath = structuredClone(fixture);
  invalidPath.assets[0].path = "../outside.png";
  assert.equal(
    validateProjectStructure(invalidPath).success,
    false,
    "越出项目根的路径必须失败。",
  );

  const absolutePath = structuredClone(fixture);
  absolutePath.assets[0].path = "C:/outside.png";
  assert.equal(
    validateProjectStructure(absolutePath).success,
    false,
    "Windows 绝对路径必须失败。",
  );

  const nullSpeech = structuredClone(fixture) as unknown as {
    scenes: Array<{ speech?: unknown }>;
  };
  nullSpeech.scenes[0].speech = null;
  assert.equal(
    validateProjectStructure(nullSpeech).success,
    false,
    "可选 Speech 不能用 null 表达。",
  );

  const danglingReference = structuredClone(fixture);
  const firstVisual = danglingReference.scenes[0].visual;
  assert.equal(firstVisual.type, "image");
  if (firstVisual.type === "image") {
    firstVisual.assetId = "40000000-0000-4000-8000-000000000001";
  }
  assert.ok(
    validateProjectConsistency(danglingReference).some(
      (diagnostic) => diagnostic.code === "SCENE_ASSET_MISSING",
    ),
    "悬空 Asset ID 必须导致内部一致性校验失败。",
  );

  console.log(
    JSON.stringify(
      {
        fixtureScenes: fixture.scenes.length,
        aiScenes: ai.scenes.length,
        assetsPreserved: ai.assets.length,
        visualTypes: [...visualTypes].sort(),
        captions: captions.length,
        jsonSchemaDraft: projectV3JsonSchema.$schema,
        negativeCases: 5,
        diagnostics: 0,
      },
      null,
      2,
    ),
  );
}

void main();
