import { z } from 'zod';
import type { RenderProgramInputV1 } from '../../../src/runtime';

const text = z.string().min(1).max(4000);
/** 条件表达目标而非建议文案；运行时仅核对可证明的内容属性。 */
export const sceneCondition = z.object({
  field: z.enum(['narration', 'asset', 'deleted']),
  description: text,
  minLength: z.number().int().min(0).max(100000).default(1),
  maxLength: z.number().int().min(1).max(100000).default(100000),
  anyOf: z.array(text).max(40).default([]),
}).strict();
export const sceneSuggestion = z.object({
  sceneId: z.string().uuid(), observation: text, action: text, content: text, reason: text,
  required: z.boolean().default(false), condition: sceneCondition.nullable().default(null),
}).strict();
export const pendingSuggestion = sceneSuggestion.extend({ satisfied: z.boolean().default(false), missing: z.boolean().default(false) });
export function evaluateSuggestion(item: z.infer<typeof pendingSuggestion>, input: RenderProgramInputV1) {
  const scene = input.scenes.find((entry) => entry.id === item.sceneId);
  const condition = item.condition;
  let satisfied = false;
  if (condition?.field === 'deleted') satisfied = !scene;
  else if (scene && condition?.field === 'narration') {
    const value = scene.narration;
    const length = [...value.trim()].length;
    satisfied = length >= condition.minLength && length <= condition.maxLength && (!condition.anyOf.length || condition.anyOf.some(part => value.includes(part)));
  } else if (scene && condition?.field === 'asset') {
    satisfied = scene.assetIds.some((id: string) => input.assets.some((asset) => asset.id === id && asset.availability === 'available' && asset.src && (!condition.anyOf.length || condition.anyOf.includes(id))));
  }
  return { ...item, satisfied, missing: !scene };
}
export const briefProposal = z.object({ id: z.string().uuid(), base: z.string().max(2097152), baseline: text, content: z.string().max(2097152), purpose: text, status: z.enum(['review', 'stale', 'rejected', 'saved']) }).strict();
export const messageDecision = z.object({
  verificationToken: z.string(), kind: z.enum(['creation', 'discussion', 'mixed', 'ambiguous']),
  fragments: z.array(text).max(20), reply: text, divergence: z.string().max(4000),
}).strict();
export const pendingMessage = z.object({ id: z.string().uuid(), original: text, fragments: z.array(text).max(20), reply: text, previousStatus: z.enum(['running', 'waiting', 'stopped']).default('waiting'), previousReason: z.string().nullable().default(null) }).strict();
/** 保守识别明确写入命令，疑问、否定或未识别表达一律走审核提案。 */
export function authorizesBrief(instruction: string) {
  const latest = instruction.split('\n\n').at(-1)!.trim();
  if (/[?？]|不要|别|不必|无需|不能|是否|能否|批准|同意|确认后|解释|如何|保持|不变|如果|等我|先讨论|暂不|前先|之前|方案|建议|备份/.test(latest)) return false;
  return /^(?:请\s*|帮我\s*|请帮我\s*)?(?:直接\s*)?(?:(?:更新|修改|重写|写入|保存|编写|补充)\s*(?:Video\s*Brief|Brief|video\.md)\s*(?:[。！!]?|[：:][\s\S]+|(?:为|成)[\s\S]+)|(?:将|把)?\s*(?:Video\s*Brief|Brief|video\.md)\s*(?:改为|改成|更新为|写成)[\s\S]+)$/i.test(latest);
}
